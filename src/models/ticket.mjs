import mongoose from 'mongoose';

import options from './options.mjs';

// un billet acheté par une personne (pas forcément inscrite sur le réseau)
const Schema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  ticket_type: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TicketType',
    required: true
  },
  // prix payé au moment de l'achat (le type de billet peut changer de prix ensuite)
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  buyer: {
    firstname: { type: String, required: true, trim: true, maxlength: 50 },
    lastname: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, lowercase: true, trim: true },
    address: {
      street: { type: String, required: true, trim: true, maxlength: 200 },
      zip_code: { type: String, required: true, trim: true, maxlength: 20 },
      city: { type: String, required: true, trim: true, maxlength: 100 },
      country: { type: String, required: true, trim: true, maxlength: 100 }
    }
  },
  purchased_at: {
    type: Date,
    default: Date.now,
    immutable: true
  }
}, options('tickets'));

// une personne extérieure ne peut obtenir qu'un seul billet par événement
Schema.index({ event: 1, 'buyer.email': 1 }, { unique: true });

export default Schema;
