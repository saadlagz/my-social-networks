import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  thread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread',
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  // null pour un message, id du message parent pour une réponse
  reply_to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  }
}, options('messages'));

Schema.index({ thread: 1, created_at: 1 });
Schema.index({ reply_to: 1 });

export default Schema;
