import validate from '../utils/validate.mjs';
import { badRequest, forbidden, notFound } from '../utils/http-error.mjs';
import { paginate, queryId } from '../utils/query.mjs';
import {
  PUBLIC_USER, findById, isGroupAdmin, isOrganizer, loadEvent, loadGroup, sameUser
} from '../utils/access.mjs';
import rules from '../validators/thread.mjs';

const Threads = class Threads {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.Message = models.Message;
    this.auth = auth;

    this.run();
  }

  /**
   * Charge un fil et vérifie les droits de l'utilisateur.
   * - fil de groupe : lecture = groupe public ou membre, écriture = membre
   * - fil d'événement : lecture et écriture = participant
   * canPost : un membre peut publier un nouveau message si le groupe l'autorise (il peut toujours répondre)
   * canModerate : administrateur du groupe / organisateur de l'événement
   */
  async loadThread(id, user, mode) {
    const thread = await findById(this.models.Thread, id, 'Thread');

    if (thread.group) {
      const group = await loadGroup(this.models, thread.group, user, mode === 'read' ? 'read' : 'member');
      const admin = isGroupAdmin(group, user);

      return {
        thread, group, canPost: admin || group.allow_member_posts, canModerate: admin
      };
    }

    const event = await loadEvent(this.models, thread.event, user, 'participant');

    return {
      thread, event, canPost: true, canModerate: isOrganizer(event, user)
    };
  }

  async loadMessage(thread, messageId) {
    const message = await findById(this.Message, messageId, 'Message');

    if (!sameUser(message.thread, thread)) throw notFound('Message');

    return message;
  }

  getThread() {
    this.app.get('/threads/:id', this.auth.required, async (req, res) => {
      const { thread, group, event } = await this.loadThread(req.params.id, req.user, 'read');

      res.status(200).json({
        ...thread.toJSON(),
        group: group ? { _id: group._id, name: group.name, type: group.type } : null,
        event: event ? { _id: event._id, name: event.name, start_date: event.start_date } : null,
        messages_count: await this.Message.countDocuments({ thread: thread._id })
      });
    });
  }

  getMessages() {
    this.app.get('/threads/:id/messages', this.auth.required, async (req, res) => {
      const { thread } = await this.loadThread(req.params.id, req.user, 'read');
      const replyTo = queryId(req.query, 'reply_to');
      const filter = { thread: thread._id };

      // ?reply_to=<id> : uniquement les réponses à ce message
      if (replyTo) filter.reply_to = replyTo;

      res.status(200).json(await paginate(this.Message, filter, req.query, {
        sort: { created_at: 1 },
        populate: { path: 'author', select: PUBLIC_USER }
      }));
    });
  }

  createMessage() {
    this.app.post('/threads/:id/messages', this.auth.required, async (req, res) => {
      const { thread, canPost } = await this.loadThread(req.params.id, req.user, 'write');
      const { errors, value } = validate(req.body, rules.message);

      if (errors.length > 0) throw badRequest(errors);

      if (value.reply_to) {
        const parent = await this.Message.exists({ _id: value.reply_to, thread: thread._id });

        if (!parent) throw badRequest(['reply_to doit être un message de ce fil de discussion']);
      } else if (!canPost) {
        throw forbidden('dans ce groupe, seuls les administrateurs peuvent publier (les membres peuvent répondre)');
      }

      const message = await this.Message.create({
        thread: thread._id,
        author: req.user._id,
        content: value.content,
        reply_to: value.reply_to || null
      });

      await message.populate({ path: 'author', select: PUBLIC_USER });

      res.status(201).json(message);
    });
  }

  updateMessage() {
    this.app.patch('/threads/:id/messages/:messageId', this.auth.required, async (req, res) => {
      const { thread } = await this.loadThread(req.params.id, req.user, 'write');
      const message = await this.loadMessage(thread, req.params.messageId);

      if (!sameUser(message.author, req.user)) throw forbidden('seul l\'auteur peut modifier son message');

      const { errors, value } = validate(req.body, rules.update);

      if (errors.length > 0) throw badRequest(errors);

      message.content = value.content;
      await message.save();
      await message.populate({ path: 'author', select: PUBLIC_USER });

      res.status(200).json(message);
    });
  }

  deleteMessage() {
    this.app.delete('/threads/:id/messages/:messageId', this.auth.required, async (req, res) => {
      const { thread, canModerate } = await this.loadThread(req.params.id, req.user, 'write');
      const message = await this.loadMessage(thread, req.params.messageId);

      if (!sameUser(message.author, req.user) && !canModerate) {
        throw forbidden('seul l\'auteur ou un administrateur / organisateur peut supprimer ce message');
      }

      // on supprime aussi les réponses, et les réponses aux réponses
      const ids = [message._id];
      let parents = [message._id];

      while (parents.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        parents = await this.Message.find({ reply_to: { $in: parents } }).distinct('_id');
        ids.push(...parents);
      }

      await this.Message.deleteMany({ _id: { $in: ids } });

      res.status(200).json({ ...message.toJSON(), deleted_replies: ids.length - 1 });
    });
  }

  run() {
    this.getThread();
    this.getMessages();
    this.createMessage();
    this.updateMessage();
    this.deleteMessage();
  }
};

export default Threads;
