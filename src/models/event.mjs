import mongoose from 'mongoose';

import options from './options.mjs';

export const EVENT_VISIBILITIES = ['public', 'private'];

const userRef = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };

const Schema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },
  description: {
    type: String,
    maxlength: 5000
  },
  start_date: {
    type: Date,
    required: true
  },
  end_date: {
    type: Date,
    required: true,
    validate: {
      validator(value) {
        return !this.start_date || value > this.start_date;
      },
      message: 'end_date doit être après start_date'
    }
  },
  location: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  cover_photo: String,
  visibility: {
    type: String,
    enum: EVENT_VISIBILITIES,
    default: 'public'
  },
  // 1 ou plusieurs organisateurs, qui font aussi partie des participants
  organizers: {
    type: [userRef],
    validate: {
      validator: (list) => list.length > 0,
      message: 'un événement doit avoir au moins un organisateur'
    }
  },
  participants: [userRef],
  // facultatif : événement créé dans un groupe
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  // fonctionnalités activables par les organisateurs
  settings: {
    ticketing: { type: Boolean, default: false },
    shopping_list: { type: Boolean, default: false },
    carpooling: { type: Boolean, default: false }
  },
  created_by: userRef
}, options('events'));

// la billetterie n'existe que pour les événements publics
Schema.pre('validate', function checkTicketing() {
  if (this.settings.ticketing && this.visibility !== 'public') {
    this.invalidate('settings.ticketing', 'la billetterie est réservée aux événements publics');
  }
});

Schema.index({ start_date: 1 });
Schema.index({ participants: 1 });
Schema.index({ group: 1 });

export default Schema;
