import validate from '../utils/validate.mjs';
import { badRequest, conflict, forbidden } from '../utils/http-error.mjs';
import { paginate } from '../utils/query.mjs';
import {
  PUBLIC_USER, findById, isOrganizer, loadEvent, sameUser
} from '../utils/access.mjs';
import rules from '../validators/shopping.mjs';

// "Chips ", "chips" et "CHIPS" désignent la même chose : minuscules, sans accents ni espaces en trop
const normalize = (name) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const Shopping = class Shopping {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.ShoppingItem = models.ShoppingItem;
    this.auth = auth;

    this.run();
  }

  checkEnabled(event) {
    if (!event.settings.shopping_list) {
      throw conflict('la shopping list n\'est pas activée pour cet événement (settings.shopping_list)');
    }
  }

  checkArrival(event, arrivalTime) {
    if (arrivalTime > event.end_date) throw badRequest(['arrival_time doit être avant la fin de l\'événement']);
  }

  async checkUnique(event, nameKey, excludeId) {
    const filter = { event: event._id, name_key: nameKey };

    if (excludeId) filter._id = { $ne: excludeId };
    if (await this.ShoppingItem.exists(filter)) {
      throw conflict('quelqu\'un apporte déjà cet article à l\'événement');
    }
  }

  async loadItem(id, user) {
    const item = await findById(this.ShoppingItem, id, 'ShoppingItem');
    const event = await loadEvent(this.models, item.event, user, 'participant');

    this.checkEnabled(event);

    return { item, event };
  }

  getItems() {
    this.app.get('/events/:id/shopping-items', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');

      this.checkEnabled(event);

      res.status(200).json(await paginate(this.ShoppingItem, { event: event._id }, req.query, {
        sort: { arrival_time: 1 },
        populate: { path: 'user', select: PUBLIC_USER }
      }));
    });
  }

  createItem() {
    this.app.post('/events/:id/shopping-items', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');

      this.checkEnabled(event);

      const { errors, value } = validate(req.body, rules.item);

      if (errors.length > 0) throw badRequest(errors);

      const nameKey = normalize(value.name);

      this.checkArrival(event, value.arrival_time);
      await this.checkUnique(event, nameKey);

      const item = await this.ShoppingItem.create({
        ...value,
        name_key: nameKey,
        event: event._id,
        user: req.user._id
      });

      await item.populate({ path: 'user', select: PUBLIC_USER });

      res.status(201).json(item);
    });
  }

  updateItem() {
    this.app.patch('/shopping-items/:id', this.auth.required, async (req, res) => {
      const { item, event } = await this.loadItem(req.params.id, req.user);

      if (!sameUser(item.user, req.user)) throw forbidden('seule la personne qui apporte cet article peut le modifier');

      const { errors, value } = validate(req.body, rules.item, { partial: true });

      if (errors.length > 0) throw badRequest(errors);
      if (Object.keys(value).length === 0) throw badRequest(['aucun champ modifiable envoyé']);

      if (value.arrival_time) this.checkArrival(event, value.arrival_time);
      if (value.name) {
        value.name_key = normalize(value.name);
        await this.checkUnique(event, value.name_key, item._id);
      }

      item.set(value);
      await item.save();
      await item.populate({ path: 'user', select: PUBLIC_USER });

      res.status(200).json(item);
    });
  }

  deleteItem() {
    this.app.delete('/shopping-items/:id', this.auth.required, async (req, res) => {
      const { item, event } = await this.loadItem(req.params.id, req.user);

      if (!sameUser(item.user, req.user) && !isOrganizer(event, req.user)) {
        throw forbidden('seule la personne qui apporte cet article ou un organisateur peut le supprimer');
      }

      await item.deleteOne();

      res.status(200).json(item);
    });
  }

  run() {
    this.getItems();
    this.createItem();
    this.updateItem();
    this.deleteItem();
  }
};

export default Shopping;
