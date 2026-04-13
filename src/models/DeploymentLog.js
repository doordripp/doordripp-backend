const mongoose = require('mongoose');

const deploymentLogSchema = new mongoose.Schema({
  repo: { 
    type: String, 
    required: true 
  },
  branch: { 
    type: String, 
    default: 'main' 
  },
  event: { 
    type: String, 
    required: true // 'Webhook Received', 'Deployment Triggered', 'Deployment Success', 'Deployment Failed'
  },
  status: { 
    type: String, 
    enum: ['success', 'failed', 'pending'], 
    default: 'pending' 
  },
  commitHash: { 
    type: String 
  },
  commitAuthor: { 
    type: String 
  },
  commitMessage: { 
    type: String 
  },
  commandExecuted: { 
    type: String 
  },
  outputLogs: { 
    type: String 
  },
  errorMessage: { 
    type: String 
  }
}, { timestamps: true });

module.exports = mongoose.model('DeploymentLog', deploymentLogSchema);
