import mongoose from 'mongoose';

import options from './options.mjs';

export const GROUP_TYPES = ['public', 'private', 'secret'];

const userRef = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };
const notEmpty = (message) => ({ validator: (list) => list.length > 0, message });

const Schema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 2000
  },
  icon: String,
  cover_photo: String,
  type: {
    type: String,
    enum: GROUP_TYPES,
    default: 'public'
  },
  allow_member_posts: {
    type: Boolean,
    default: true
  },
  allow_member_events: {
    type: Boolean,
    default: false
  },
  // 1 ou plusieurs administrateurs, qui font aussi partie des membres
  administrators: {
    type: [userRef],
    validate: notEmpty('un groupe doit avoir au moins un administrateur')
  },
  members: {
    type: [userRef],
    validate: notEmpty('un groupe doit avoir au moins un membre')
  },
  created_by: userRef
}, options('groups'));

Schema.index({ members: 1 });

export default Schema;
