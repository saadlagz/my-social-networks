import validate from '../utils/validate.mjs';
import { badRequest, forbidden, notFound } from '../utils/http-error.mjs';
import { paginate } from '../utils/query.mjs';
import {
  PUBLIC_USER, findById, isOrganizer, loadEvent, sameUser
} from '../utils/access.mjs';
import rules from '../validators/album.mjs';

// albums photo d'un événement, leurs photos et les commentaires des photos
const Albums = class Albums {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.Album = models.Album;
    this.Photo = models.Photo;
    this.PhotoComment = models.PhotoComment;
    this.auth = auth;

    this.run();
  }

  // lecture : toute personne qui voit l'événement ; écriture : participants
  async loadAlbum(id, user, level) {
    const album = await findById(this.Album, id, 'Album');
    const event = await loadEvent(this.models, album.event, user, level);

    return { album, event };
  }

  async loadPhoto(id, user, level) {
    const photo = await findById(this.Photo, id, 'Photo');
    const event = await loadEvent(this.models, photo.event, user, level);

    return { photo, event };
  }

  // l'auteur ou un organisateur de l'événement peut modifier / supprimer
  checkOwner(owner, event, user, message) {
    if (!sameUser(owner, user) && !isOrganizer(event, user)) throw forbidden(message);
  }

  async deletePhotos(filter) {
    const ids = await this.Photo.find(filter).distinct('_id');

    await this.PhotoComment.deleteMany({ photo: { $in: ids } });
    await this.Photo.deleteMany({ _id: { $in: ids } });
  }

  /* ---------- albums ---------- */

  createAlbum() {
    this.app.post('/events/:id/albums', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');
      const { errors, value } = validate(req.body, rules.album);

      if (errors.length > 0) throw badRequest(errors);

      const album = await this.Album.create({ ...value, event: event._id, created_by: req.user._id });

      res.status(201).json(album);
    });
  }

  getAlbums() {
    this.app.get('/events/:id/albums', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user);

      res.status(200).json(await paginate(this.Album, { event: event._id }, req.query, {
        sort: { created_at: -1 },
        populate: { path: 'created_by', select: PUBLIC_USER }
      }));
    });
  }

  getAlbumById() {
    this.app.get('/albums/:id', this.auth.required, async (req, res) => {
      const { album } = await this.loadAlbum(req.params.id, req.user);

      await album.populate({ path: 'created_by', select: PUBLIC_USER });

      res.status(200).json({
        ...album.toJSON(),
        photos_count: await this.Photo.countDocuments({ album: album._id })
      });
    });
  }

  updateAlbum() {
    this.app.patch('/albums/:id', this.auth.required, async (req, res) => {
      const { album, event } = await this.loadAlbum(req.params.id, req.user, 'participant');

      this.checkOwner(album.created_by, event, req.user, 'seul le créateur de l\'album ou un organisateur peut le modifier');

      const { errors, value } = validate(req.body, rules.album, { partial: true });

      if (errors.length > 0) throw badRequest(errors);
      if (Object.keys(value).length === 0) throw badRequest(['aucun champ modifiable envoyé']);

      album.set(value);
      await album.save();

      res.status(200).json(album);
    });
  }

  deleteAlbum() {
    this.app.delete('/albums/:id', this.auth.required, async (req, res) => {
      const { album, event } = await this.loadAlbum(req.params.id, req.user, 'participant');

      this.checkOwner(album.created_by, event, req.user, 'seul le créateur de l\'album ou un organisateur peut le supprimer');

      await this.deletePhotos({ album: album._id });
      await album.deleteOne();

      res.status(200).json(album);
    });
  }

  /* ---------- photos ---------- */

  createPhoto() {
    this.app.post('/albums/:id/photos', this.auth.required, async (req, res) => {
      const { album } = await this.loadAlbum(req.params.id, req.user, 'participant');
      const { errors, value } = validate(req.body, rules.photo);

      if (errors.length > 0) throw badRequest(errors);

      const photo = await this.Photo.create({
        ...value,
        album: album._id,
        event: album.event,
        author: req.user._id
      });

      res.status(201).json(photo);
    });
  }

  getPhotos() {
    this.app.get('/albums/:id/photos', this.auth.required, async (req, res) => {
      const { album } = await this.loadAlbum(req.params.id, req.user);

      res.status(200).json(await paginate(this.Photo, { album: album._id }, req.query, {
        sort: { created_at: 1 },
        populate: { path: 'author', select: PUBLIC_USER }
      }));
    });
  }

  getPhotoById() {
    this.app.get('/photos/:id', this.auth.required, async (req, res) => {
      const { photo } = await this.loadPhoto(req.params.id, req.user);

      await photo.populate({ path: 'author', select: PUBLIC_USER });

      res.status(200).json({
        ...photo.toJSON(),
        comments_count: await this.PhotoComment.countDocuments({ photo: photo._id })
      });
    });
  }

  updatePhoto() {
    this.app.patch('/photos/:id', this.auth.required, async (req, res) => {
      const { photo } = await this.loadPhoto(req.params.id, req.user, 'participant');

      if (!sameUser(photo.author, req.user)) throw forbidden('seul l\'auteur peut modifier sa photo');

      const { errors, value } = validate(req.body, rules.photoUpdate);

      if (errors.length > 0) throw badRequest(errors);

      photo.set(value);
      await photo.save();

      res.status(200).json(photo);
    });
  }

  deletePhoto() {
    this.app.delete('/photos/:id', this.auth.required, async (req, res) => {
      const { photo, event } = await this.loadPhoto(req.params.id, req.user, 'participant');

      this.checkOwner(photo.author, event, req.user, 'seul l\'auteur ou un organisateur peut supprimer cette photo');

      await this.deletePhotos({ _id: photo._id });

      res.status(200).json(photo);
    });
  }

  /* ---------- commentaires ---------- */

  getComments() {
    this.app.get('/photos/:id/comments', this.auth.required, async (req, res) => {
      const { photo } = await this.loadPhoto(req.params.id, req.user);

      res.status(200).json(await paginate(this.PhotoComment, { photo: photo._id }, req.query, {
        sort: { created_at: 1 },
        populate: { path: 'author', select: PUBLIC_USER }
      }));
    });
  }

  createComment() {
    this.app.post('/photos/:id/comments', this.auth.required, async (req, res) => {
      const { photo } = await this.loadPhoto(req.params.id, req.user, 'participant');
      const { errors, value } = validate(req.body, rules.comment);

      if (errors.length > 0) throw badRequest(errors);

      const comment = await this.PhotoComment.create({ ...value, photo: photo._id, author: req.user._id });

      await comment.populate({ path: 'author', select: PUBLIC_USER });

      res.status(201).json(comment);
    });
  }

  deleteComment() {
    this.app.delete('/photos/:id/comments/:commentId', this.auth.required, async (req, res) => {
      const { photo, event } = await this.loadPhoto(req.params.id, req.user, 'participant');
      const comment = await findById(this.PhotoComment, req.params.commentId, 'Comment');

      if (!sameUser(comment.photo, photo)) throw notFound('Comment');

      this.checkOwner(comment.author, event, req.user, 'seul l\'auteur ou un organisateur peut supprimer ce commentaire');

      await comment.deleteOne();

      res.status(200).json(comment);
    });
  }

  run() {
    this.createAlbum();
    this.getAlbums();
    this.getAlbumById();
    this.updateAlbum();
    this.deleteAlbum();
    this.createPhoto();
    this.getPhotos();
    this.getPhotoById();
    this.updatePhoto();
    this.deletePhoto();
    this.getComments();
    this.createComment();
    this.deleteComment();
  }
};

export default Albums;
