/* =====================================================
   AUTENTICAÇÃO — Firebase Auth + Google
===================================================== */
class AuthManager {
  constructor() {
    this.user     = null;
    this.provider = null;
    this._listeners = [];
  }

  init() {
    this.provider = new firebase.auth.GoogleAuthProvider();

    firebase.auth().onAuthStateChanged(user => {
      this.user = user;
      this._listeners.forEach(fn => fn(user));

      if (user && !user.isAnonymous) {
        this._syncUserProfile(user);
      }
    });
  }

  onChange(fn) { this._listeners.push(fn); }

  async loginWithGoogle() {
    try {
      const result = await firebase.auth().signInWithPopup(this.provider);
      return result.user;
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') throw e;
      return null;
    }
  }

  async loginAnonymously() {
    const result = await firebase.auth().signInAnonymously();
    return result.user;
  }

  async logout() {
    await firebase.auth().signOut();
  }

  async _syncUserProfile(user) {
    const ref = firebase.database().ref('users/' + user.uid);
    const snap = await ref.once('value');
    const existing = snap.val() || {};

    await ref.update({
      displayName: user.displayName  || existing.displayName || 'Jogador',
      photoURL:    user.photoURL     || existing.photoURL    || '',
      email:       user.email        || '',
      lastSeen:    Date.now(),
      gamesPlayed: existing.gamesPlayed || 0,
      wins:        existing.wins        || 0,
      losses:      existing.losses      || 0,
      draws:       existing.draws       || 0
    });
  }

  get isLoggedIn()   { return !!this.user && !this.user.isAnonymous; }
  get isAnonymous()  { return this.user?.isAnonymous === true; }
  get uid()          { return this.user?.uid || null; }
  get displayName()  { return this.user?.displayName || 'Visitante'; }
  get photoURL()     { return this.user?.photoURL || null; }
  get initials()     {
    const name = this.displayName;
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
}

const auth = new AuthManager();