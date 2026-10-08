import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  album: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Album',
    required: true
  },
  // copie de l'événement de l'album : évite une requête de plus pour vérifier les droits
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  // posté par 1 participant de l'événement
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  url: {
    type: String,
    required: true
  },
  caption: {
    type: String,
    maxlength: 500
  }
}, options('photos'));

Schema.index({ album: 1, created_at: 1 });

export default Schema;
