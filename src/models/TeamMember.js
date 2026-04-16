const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  roleTitle: {
    type: String,
    required: true,
    trim: true
  },
  companyLabel: {
    type: String,
    trim: true,
    default: 'Doordripp Private Limited'
  },
  introLabel: {
    type: String,
    trim: true,
    default: "Hi, I'm"
  },
  photoUrl: {
    type: String,
    required: true,
    trim: true
  },
  statement: {
    type: String,
    required: true,
    trim: true
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TeamMember', teamMemberSchema);
