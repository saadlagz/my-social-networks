import { EVENT_VISIBILITIES } from '../models/event.mjs';

const settings = {
  type: 'object',
  default: {},
  rules: {
    ticketing: { type: 'boolean', default: false },
    shopping_list: { type: 'boolean', default: false },
    carpooling: { type: 'boolean', default: false }
  }
};

const event = {
  name: { type: 'string', required: true, max: 150 },
  description: { type: 'string', max: 5000, nullable: true },
  start_date: { type: 'date', required: true },
  end_date: { type: 'date', required: true },
  location: { type: 'string', required: true, max: 300 },
  cover_photo: { type: 'url', nullable: true },
  visibility: { type: 'enum', values: EVENT_VISIBILITIES, default: 'public' },
  settings
};

export default {
  // étape 1 : informations essentielles + organisateurs et membres
  create: {
    ...event,
    organizers: { type: 'ids', default: [] },
    participants: { type: 'ids', default: [] },
    group: { type: 'id', nullable: true },
    // invite tous les membres du groupe "en un clic"
    invite_group_members: { type: 'boolean', default: false }
  },
  update: event,
  participants: {
    user_ids: { type: 'ids', required: true, min: 1 },
    role: { type: 'enum', values: ['participant', 'organizer'], default: 'participant' }
  },
  role: {
    role: { type: 'enum', values: ['participant', 'organizer'], required: true }
  }
};
