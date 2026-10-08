import { GROUP_TYPES } from '../models/group.mjs';

export default {
  group: {
    name: { type: 'string', required: true, max: 100 },
    description: { type: 'string', max: 2000, nullable: true },
    icon: { type: 'url', nullable: true },
    cover_photo: { type: 'url', nullable: true },
    type: { type: 'enum', values: GROUP_TYPES, default: 'public' },
    allow_member_posts: { type: 'boolean', default: true },
    allow_member_events: { type: 'boolean', default: false }
  },
  members: {
    user_ids: { type: 'ids', required: true, min: 1 },
    role: { type: 'enum', values: ['member', 'admin'], default: 'member' }
  },
  role: {
    role: { type: 'enum', values: ['member', 'admin'], required: true }
  }
};
