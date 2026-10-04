/**
 * Account deletion.
 *
 * DELETED (personal data with no retention requirement)
 *   cart, wishlist, saved addresses, OTPs, pending registration, in-app
 *   notifications, support tickets, newsletter subscription, staff area
 *   assignments, stored avatar file, push-notification identity
 *
 * ANONYMISED
 *   the user row itself. It is kept as a tombstone with every personal field
 *   wiped (name, email, phone, password, Google/Apple ids, avatar, address) so
 *   that orders, invoices and reviews keep a valid reference instead of a
 *   dangling one. Reviews stay, attributed to "Deleted User".
 *
 * RETAINED (statutory / accounting records)
 *   orders, trial orders and tax invoices, including the billing and shipping
 *   details printed on them. Indian GST rules require invoices and the
 *   supporting records to be kept for several years.
 *
 * Everything in the database happens in ONE transaction: a failure part-way
 * leaves the account completely intact, and a retry starts clean. Running it
 * again for an already deleted account is a no-op.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const User = require('../models/User');
const Cart = require('../models/Cart');
const Wishlist = require('../models/Wishlist');
const Address = require('../models/Address');
const Otp = require('../models/Otp');
const PendingUser = require('../models/PendingUser');
const Notification = require('../models/Notification');
const SupportTicket = require('../models/SupportTicket');
const Newsletter = require('../models/Newsletter');
const AreaManager = require('../models/AreaManager');
const RevokedToken = require('../models/RevokedToken');

const DELETED_NAME = 'Deleted User';
const tombstoneEmail = (userId) => `deleted-${userId}@deleted.invalid`;

async function deleteUserAccount(userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) return { deleted: false, reason: 'not_found' };

  let snapshot = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user) { snapshot = { reason: 'not_found' }; return; }
      if (user.isDeleted) { snapshot = { reason: 'already_deleted' }; return; }

      const identifiers = [user.email, user.phone].filter(Boolean);
      snapshot = { avatar: user.avatar };

      await Cart.deleteMany({ user: user._id }, { session });
      await Wishlist.deleteMany({ user: user._id }, { session });
      await Address.deleteMany({ userId: user._id }, { session });
      await Otp.deleteMany({ $or: [{ identifier: { $in: identifiers } }, { user: user._id }] }, { session });
      await PendingUser.deleteMany({ email: user.email }, { session });
      await Notification.deleteMany({ recipient: user._id }, { session });
      await SupportTicket.deleteMany({ $or: [{ userId: user._id }, { email: user.email }] }, { session });
      await Newsletter.deleteMany({ email: user.email }, { session });
      await AreaManager.deleteMany({ manager: user._id }, { session });
      await RevokedToken.deleteMany({ user: user._id }, { session });

      // Tombstone. updateOne (not save) so no model hook can re-derive personal fields.
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            name: DELETED_NAME,
            email: tombstoneEmail(user._id),
            password: `!deleted:${crypto.randomBytes(32).toString('hex')}`,
            avatar: null,
            roles: [],
            emailVerified: false,
            phoneVerified: false,
            isPasswordSet: false,
            authProvider: 'local',
            refreshToken: null,
            keepTokenHash: null,
            resetPasswordToken: null,
            resetPasswordExpires: null,
            managerFor: null,
            lastTrialDate: null,
            isDeleted: true,
            deletedAt: new Date()
          },
          // Unique sparse fields must be removed, not nulled, so they can be reused.
          $unset: { phone: '', googleId: '', appleId: '', address: '', deliveryPartner: '', banReason: '' },
          // Invalidates every session token issued for this account.
          $inc: { tokenVersion: 1 }
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  if (!snapshot || snapshot.reason) {
    return { deleted: false, reason: snapshot ? snapshot.reason : 'not_found' };
  }

  // External / filesystem cleanup can not join the transaction. It is best-effort
  // and safe to repeat; a failure here never resurrects the account.
  await removeLocalAvatar(userId, snapshot.avatar);
  await removePushIdentity(userId);

  return { deleted: true };
}

async function removeLocalAvatar(userId, avatar) {
  try {
    const file = path.join(__dirname, '..', 'public', 'uploads', 'avatars', `${userId}.jpg`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (avatar && /^https?:\/\//.test(String(avatar)) && /imagekit/i.test(String(avatar))) {
      // The CDN copy can only be removed with its ImageKit fileId, which is not stored.
      logger.warn(`Account ${userId} deleted: its avatar on the image CDN must be removed manually`);
    }
  } catch (err) {
    logger.warn('Could not remove avatar file for deleted account', err);
  }
}

async function removePushIdentity(userId) {
  const appId = process.env.APP_ONESIGNAL_APP_ID;
  const apiKey = process.env.APP_ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey || typeof fetch !== 'function') return;
  try {
    const response = await fetch(
      `https://api.onesignal.com/apps/${encodeURIComponent(appId)}/users/by/external_id/${encodeURIComponent(String(userId))}`,
      { method: 'DELETE', headers: { Authorization: /^os_v2_/i.test(apiKey) ? `Key ${apiKey}` : `Basic ${apiKey}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok && response.status !== 404) {
      logger.warn(`OneSignal user removal returned HTTP ${response.status} for deleted account ${userId}`);
    }
  } catch (err) {
    logger.warn('Could not remove push identity for deleted account', err);
  }
}

module.exports = { deleteUserAccount, DELETED_NAME, tombstoneEmail };
