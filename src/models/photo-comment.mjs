import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  photo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Photo',
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
    maxlength: 1000
  }
}, options('photo_comments'));

Schema.index({ photo: 1, created_at: 1 });

export default Schema;
