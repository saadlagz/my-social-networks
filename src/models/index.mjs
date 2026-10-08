import UserSchema from './user.mjs';
import GroupSchema from './group.mjs';
import EventSchema from './event.mjs';
import ThreadSchema from './thread.mjs';
import MessageSchema from './message.mjs';
import AlbumSchema from './album.mjs';
import PhotoSchema from './photo.mjs';
import PhotoCommentSchema from './photo-comment.mjs';
import PollSchema from './poll.mjs';
import PollAnswerSchema from './poll-answer.mjs';
import TicketTypeSchema from './ticket-type.mjs';
import TicketSchema from './ticket.mjs';
import ShoppingItemSchema from './shopping-item.mjs';
import CarpoolSchema from './carpool.mjs';

// les modèles sont déclarés une seule fois sur la connexion puis partagés par les contrôleurs
export default (connect) => ({
  User: connect.model('User', UserSchema),
  Group: connect.model('Group', GroupSchema),
  Event: connect.model('Event', EventSchema),
  Thread: connect.model('Thread', ThreadSchema),
  Message: connect.model('Message', MessageSchema),
  Album: connect.model('Album', AlbumSchema),
  Photo: connect.model('Photo', PhotoSchema),
  PhotoComment: connect.model('PhotoComment', PhotoCommentSchema),
  Poll: connect.model('Poll', PollSchema),
  PollAnswer: connect.model('PollAnswer', PollAnswerSchema),
  TicketType: connect.model('TicketType', TicketTypeSchema),
  Ticket: connect.model('Ticket', TicketSchema),
  ShoppingItem: connect.model('ShoppingItem', ShoppingItemSchema),
  Carpool: connect.model('Carpool', CarpoolSchema)
});
