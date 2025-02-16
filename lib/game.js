/* eslint-disable */

function gameIsSolved(game) {
  const fills = Fills.find({ game: game._id }).fetch();
  const squares = Squares.find({ puzzle: game.puzzle }).fetch();
  const fillsBySquare = {};
  fills.forEach((fill) => {
    fillsBySquare[fill.square] = fill.letter;
  });
  return _.all(squares, (s) => s.black || fillsBySquare[s._id] == s.letter);
}

function checkGame(gameId) {
  if (!Meteor.isServer) {
    // Force server-side checking so the client doesn't block input
    return;
  }
  const game = Games.findOne({ _id: gameId });
  let start = new Date();
  const solved = gameIsSolved(game);
  let end = new Date();
  if (solved !== game.solved) {
    Games.update({_id: gameId}, { $set: { solved: solved } });
  }
}

function eachSquare(state, target, fn) {
  var square = Squares.findOne({_id: state.square});
  if (!square)
    throw new Error("No such square: " + state.square);
  var targets;
  if (target === 'grid') {
    targets = Squares.find({puzzle: square.puzzle, black: null}).fetch();
  } else if (target === 'word') {
    var q = {puzzle: square.puzzle};
    q['word_' + state.direction] = square['word_' + state.direction];
    targets = Squares.find(q).fetch();
  } else if (target === 'square') {
    targets = [square];
    var fill = Fills.findOne({square: state.square, game: state.game});
    fn(square, fill);
  } else {
    throw new Error("Unknown target: " + target);
  }
  targets.forEach(function (s) {
    var fill = Fills.findOne({square: s._id, game: state.game});
    fn(s, fill);
  });
}

function revealOne(square, fill) {
  if (fill.letter != square.letter) {
    Fills.update({_id: fill._id},
                 { $set: {
                     letter: square.letter,
                     reveal: true,
                     checked: fill.checked ? 'checked' : null,
                     correct: true
                   }
                 });
  }
}

function checkOne(square, fill) {
  if (!fill.letter) {
    // Checking a blank square doesn't mark it wrong, but returning true will avoid selecting the blank square.
    return true;
  }
  if (fill.letter !== square.letter) {
    Fills.update({_id: fill._id},
                 { $set: {
                     checked: 'checking'
                   }});
    return false;
  }
  Fills.update({_id: fill._id},
                 { $set: {
                     correct: true
                   }});
  return true;
}

function setOne(game, square, letter, pencil) {
  var fill = Fills.findOne({square: square, game: game});
  if (!fill)
    return;

  if (fill.letter !== letter || pencil !== fill.pencil) {
    var set = {letter: letter};
    if (fill.checked === 'checking')
      set.checked = 'checked';
    set.pencil = !!pencil;
    Fills.update({_id: fill._id}, {$set: set});
    checkGame(game);
  }
}

function pingPresence(gameid) {
  if (Meteor.userId()) {
    var userId = Meteor.userId();
    var now = new Date();
    if (Meteor.isServer) {
      // minimongo doesn't support the $ positional operator in
      // updates, and it doesn't seem to DTRT with the first query. So
      // don't run these client-side, just let the server run them and
      // propagate back.
      Games.update({_id: gameid, 'players.userId': {$ne: userId}},
                   {$push: {'players': {userId: userId, lastSeen: now}}});
      Games.update({_id: gameid, 'players.userId': userId},
                   {$set: {'players.$.lastSeen': now}});
    }
  }
}

Meteor.methods({
  newGame: function (puzid) {
    var puz = Puzzles.findOne({_id: puzid});
    if (!puz)
      throw new Error("Unknown puzzle: " + puz);
    var gid = Games.insert({puzzle: puzid, created: new Date()});
    Squares.find({puzzle: puzid}).forEach(function (square) {
      Fills.insert({puzzle: square.puzzle, letter: null, square: square._id, game: gid});
    });
    pingPresence(gid);
    return gid;
  },
  setLetter: function (game, square, letter, pencil) {
    // pingPresence(game);
    setOne(game, square, letter, pencil);
  },
  clearLetter: function (game, square) {
    // pingPresence(game);
    setOne(game, square, null, false);
  },
  /*
   * state has keys:
   *  - game
   *  - square
   *  - direction
   */
  reveal: function (state, target) {
    pingPresence(state.game);
    eachSquare(state, target, revealOne);
    checkGame(state.game);
  },
  check: function (state, target) {
    var wrong = null;
    pingPresence(state.game);
    eachSquare(state, target, function (s,f) {
      if (!checkOne(s, f) && !wrong)
        wrong = s._id;
    });
    checkGame(state.game);
    return wrong;
  },
  'ping': function (gameid) {
    pingPresence(gameid);
  },
  'setName': function (name) {
    if (typeof name !== 'string') {
      return;
    }
    check(name, String);
    check(Meteor.userId(), String);
    Meteor.users.update({_id: Meteor.userId()},
                        {$set: {'profile.name': name}});
  },
  'updateSetting': function (setting, value) {
    check(Meteor.userId(), String);
    var newProfile = {};
    newProfile['profile.' + setting] = value;
    Meteor.users.update({_id: Meteor.userId()},
                        {$set: newProfile});
  },
});
