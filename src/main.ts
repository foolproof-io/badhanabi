import * as _ from "lodash";
import m from "mithril";
import * as firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";

function strictParse(value: string): number {
  return /^(-|\+)?(\d+|Infinity)$/.test(value) ? Number(value) : NaN;
}

type Color = string;
type Rank = string;
type Tile = string;
type Hint = string;
const COLORS: Color[] = ["R", "G", "B", "Y", "W", "P"];
const RANKS: Rank[] = ["1", "2", "3", "4", "5"];
const UNKNOWN: Tile = "UU";

interface HandItem {
  // If it is a tile
  tile?: Tile;
  hints?: Hint[];
  // If it is a hint marker
  hint?: Hint;
}

function generateDeck(): Tile[] {
  let tiles: Tile[] = [];
  COLORS.forEach(c => {
    tiles.push(`${c}1`);
    tiles.push(`${c}1`);
    tiles.push(`${c}1`);
    tiles.push(`${c}2`);
    tiles.push(`${c}2`);
    tiles.push(`${c}3`);
    tiles.push(`${c}3`);
    tiles.push(`${c}4`);
    tiles.push(`${c}4`);
    tiles.push(`${c}5`);
  });
  return _.shuffle(tiles);
}
function handSize(num_players) {
  switch (num_players) {
    case 2:
      return 6;
    case 3:
      return 5;
    case 4:
      return 4;
    case 5:
      return 4;
    default:
      return -1;
  }
}
const NUM_INITIAL_HINTS = 8;
function drawTiles(tiles: Tile[], num_tiles: number): HandItem[] {
  let ts: HandItem[] = [];
  for (let i = 0; i < num_tiles; i++) {
    ts.push({ tile: tiles.pop(), hints: [] });
  }
  return ts;
}

function playerAfter(players, p) {
  const idx = players.indexOf(p);
  return players[(idx + 1) % players.length];
}

function summarizePlayPile(play_pile) {
  let highest_by_color = {};
  COLORS.forEach(c => {
    highest_by_color[c] = 0;
  });
  play_pile.forEach(tile => {
    const c = tile[0];
    const r = strictParse(tile[1]);
    highest_by_color[c] = Math.max(highest_by_color[c], r);
  });
  return highest_by_color;
}
function isLegalPlay(play_pile, tile) {
  const summary = summarizePlayPile(play_pile);
  const c = tile[0];
  const r = strictParse(tile[1]);
  return r === summary[c] + 1;
}
function applyHintToHand(hand, hint) {
  let applied = hand.map(item => {
    if (item.tile && matchesHint(item.tile, hint)) {
      item.hints.push(hint);
    }
    return item;
  });
  applied.push({ hint });
  return applied;
}

function removeCardFromHand(hand, idx) {
  let minus_card = hand.slice(0, idx).concat(hand.slice(idx + 1));
  // trim off any leading hints, they give no information
  while (minus_card.length > 0 && minus_card[0].hint) {
    minus_card.shift();
  }
  return minus_card;
}

function matchesHint(tile: Tile, hint: Hint): boolean {
  return tile.indexOf(hint) !== -1;
}

const ROOM_STATES = {
  WAITING_TO_START: "waiting to start",
  WAITING_FOR_PLAYER: player => `waiting for ${player}`
};
function viewModel(model, handler) {
  return m("div", [
    m("div", { id: "whoami" }, `You are: ${model.uid}`),
    m("div", { id: "state" }, model.room.state || "waiting to start"),
    m("div", { id: "draws" }, `Draws: ${(model.room.draw_pile || []).length}`),
    m("div", { id: "hints" }, `Hints: ${model.room.hints}`),
    m("div", { id: "errors" }, `Errors: ${model.room.errors}`),
    m("div", { id: "discards" }, [
    "Discards:",
     viewDiscardPile(model.room.discard_pile || []),
    ]),
    m("div", { id: "plays" }, [
      "Plays:",
      viewPlayPile(model.room.play_pile || [])
    ]),

    m(
      "div",
      {
        id: "players"
      },
      [
        "Players:",
        rotateToLast(
          model.room.players || model.room.viewers || [],
          model.uid
        ).map(player => {
          const name = (model.room.names && model.room.names[player]) || player;
          if (!model.room.hands) {
            return m("p", name);
          }
          const hand = model.room.hands[player];
          const player_view = viewPlayer(
            name,
            player === model.uid ? redactTiles(hand) : hand
          );
          return m(
            "div",
            {
              class:
                model.room.state === ROOM_STATES.WAITING_FOR_PLAYER(player)
                  ? "current_player"
                  : "waiting_player"
            },
            player_view
          );
        })
      ]
    ),

    m("input", {
      id: "user_input",
      onkeypress: handler,
      placeholder: "user_input goes here",
      autofocus: true
    }),

    m("div", { id: "helptext" }, model.helptext),

    m(
      "div",
      {
        id: "actions"
      },
      model.actions.map(msg => m("p", msg.text))
    )
  ]);
}
function viewDiscardPile(discard_pile: Tile[]): m.Child {
  console.log("discard_pile = ", discard_pile);
  return m("table", {}, COLORS.map(c => {
    let discards_of_color: Tile[] = discard_pile.filter(t => matchesHint(t, c)).sort();
    console.log(`discard_pile[${c}] = `, discards_of_color);
    return m("tr", discards_of_color.map(t => m("td", viewDiscardedTile(t))))
  }));
}
function viewDiscardedTile(tile: Tile): m.Child {
  return m("img", {
    class: "discard",
    src: `./imgs/tiles/${tile}.svg`
  });
}
function viewPlayPile(play_pile) {
  const summary = summarizePlayPile(play_pile);
  return m("table", [
    m("tr", COLORS.map(c => m("td", viewPile(c, summary[c]))))
  ]);
}
function viewPile(color, rank) {
  return m("img", {
    class: "pile",
    src: `./imgs/piles/${color}${rank}.svg`
  });
}
function viewPlayer(player_name, hand) {
  return m("div", [
    player_name,
    m("table", [
      m("tr", hand.map((item, idx) => m("td", idx))),
      m("tr", hand.map(item => m("td", viewHandItem(item)))),
      m("tr", hand.map(item => m("td", viewTileHints(item.hints))))
    ])
  ]);
}
function viewHandItem(item) {
  return item.tile ? viewTile(item.tile) : viewMarker(item.hint);
}
function viewTile(tile: Tile): m.Child {
  return m("img", {
    class: "tile",
    src: `./imgs/tiles/${tile}.svg`
  });
}
function viewTileHints(hints: Hint[]): m.Child {
  if (!hints) {
    return "";
  }
  const color = _.find(hints, h => COLORS.indexOf(h) >= 0);
  const rank = _.find(hints, h => RANKS.indexOf(h) >= 0);
  return m("div", [
    m("img", { class: "hint", src: `./imgs/hints/${color || "U"}.svg` }),
    m("img", { class: "hint", src: `./imgs/hints/${rank || "U"}.svg` })
  ]);
}

function viewMarker(hint: Hint): m.Child {
  return m("img", {
    class: "marker",
    src: `./imgs/hints/${hint}.svg`
  });
}

function rotateToLast(xs, x) {
  const idx = xs.indexOf(x);
  return idx === -1 ? xs : xs.slice(idx + 1).concat(xs.slice(0, idx + 1));
}
function redactTiles(hand) {
  return hand.map(item => (item.tile ? redactTile(item) : item));
}
function redactTile(item) {
  return { tile: UNKNOWN, hints: item.hints };
}
document.addEventListener("DOMContentLoaded", function() {
  firebase.initializeApp({
    apiKey: "AIzaSyBIb0BX7QA5K42j12QZH_E3UB8QH_sPpr8",
    projectId: "foolproof-hanabi"
  });
  const room_id = window.location.pathname.substring(1);
  let model: any = {
    actions: [],
    helptext: "try 'help' or '?'",
    room: {
      state: null,
      players: [],
      viewers: [],
      names: {},
      hands: null,
      errors: null,
      hints: null,
      discard_pile: null,
      play_pile: null,
      draw_pile: null
    },
    uid: null,
    view: () => viewModel(model, handler)
  };

  const app = firebase.app();
  const remote = {
    room: app
      .firestore()
      .collection("rooms")
      .doc(room_id),
    actions: app
      .firestore()
      .collection("rooms")
      .doc(room_id)
      .collection("actions")
  };
  app.auth().onAuthStateChanged(evt => {
    if (evt && evt.uid) {
      model.uid = evt.uid;
      remote.room.set(
        {
          viewers: firebase.firestore.FieldValue.arrayUnion(model.uid)
        },
        { merge: true }
      );
    }
  });
  remote.room.onSnapshot(snap => {
    if (snap.exists) {
      model.room = snap.data() as any;
      m.redraw();
    }
  });
  remote.actions.orderBy("time", "desc").onSnapshot(snap => {
    model.actions = snap.docs.map(doc => doc.data());
    m.redraw();
  });

  function note(msg) {
    model.helptext = msg;
    return true;
  }
  function log(msg) {
    remote.actions.add({
      time: firebase.firestore.FieldValue.serverTimestamp(),
      text: msg
    });
    return true;
  }

  function help() {
    if (!model.uid) {
      return note("you're not logged in yet, this should happen automatically");
    }
    if (!model.room) {
      return note("waiting for room to load, this should happen automatically");
    }
    if (!model.room.state) {
      return note("this game hasn't started yet, try 'start'");
    }
    return note(
      "you can 'discard <tile_idx>', 'play <tile_idx>', or 'hint <player> <hint>'"
    );
  }
  function setName(name: string) {
    if (!model.uid || !model.room) {
      return note("loading...");
    }
    if (!/\w/.test(name)) {
      return note(`invalid name: ${name}`);
    }
    let update = {};
    update[`names.${model.uid}`] = name;
    remote.room.update(update);
    return log(`${model.uid} set name to ${name}`);
  }
  function startGame() {
    if (model.room.state) {
      return note(`game has already started`);
    }

    const players = model.room.viewers;
    const hand_size = handSize(players.length);
    if (hand_size < 0) {
      return note(
        `wrong number of players, we can support 2--5, you have ${
          players.length
        }`
      );
    }
    let deck = generateDeck();
    let hands = {};
    players.forEach(player => {
      hands[player] = drawTiles(deck, hand_size);
    });
    remote.room.update({
      players,
      draw_pile: deck,
      discard_pile: [],
      play_pile: [],
      hints: NUM_INITIAL_HINTS,
      errors: 0,
      hands,
      state: ROOM_STATES.WAITING_FOR_PLAYER(players[0])
    });
    return log("game has begun!");
  }
  function discardTile(idx_str) {
    if (model.room.state !== ROOM_STATES.WAITING_FOR_PLAYER(model.uid)) {
      return note("not your turn");
    }
    const idx = strictParse(idx_str);
    const hand = model.room.hands[model.uid];
    if (!hand[idx] || !hand[idx].tile) {
      return note(`can't discard that, try again`);
    }
    let update = {};
    update["state"] = ROOM_STATES.WAITING_FOR_PLAYER(
      playerAfter(model.room.players, model.uid)
    );
    update["hints"] = Math.min(model.room.hints + 1, NUM_INITIAL_HINTS);
    update["discard_pile"] = model.room.discard_pile.concat(hand[idx].tile);
    const next_tile = model.room.draw_pile[0];
    let next_hand = removeCardFromHand(hand, idx);
    if (next_tile) {
      update["draw_pile"] = model.room.draw_pile.slice(1);
      next_hand.push({ tile: next_tile, hints: [] });
    }
    update[`hands.${model.uid}`] = next_hand;
    remote.room.update(update);
    return log(`${model.uid} discarded ${hand[idx].tile}`);
  }
  function playTile(idx_str) {
    if (model.room.state !== ROOM_STATES.WAITING_FOR_PLAYER(model.uid)) {
      return note("not your turn");
    }
    const idx = strictParse(idx_str);
    const hand = model.room.hands[model.uid];
    if (!hand[idx] || !hand[idx].tile) {
      return note(`can't play that, try again`);
    }
    let update = {};
    update["state"] = ROOM_STATES.WAITING_FOR_PLAYER(
      playerAfter(model.room.players, model.uid)
    );
    if (isLegalPlay(model.room.play_pile, hand[idx].tile)) {
      update["play_pile"] = model.room.play_pile.concat(hand[idx].tile);
      log(`${model.uid} played ${hand[idx].tile}`);
      if (hand[idx].tile[1] === "5") {
        update["hints"] = model.room.hints + 1;
      }
    } else {
      update["errors"] = model.room.errors + 1;
      update["discard_pile"] = model.room.discard_pile.concat(hand[idx].tile);
      log(`${model.uid} tried to play ${hand[idx].tile}`);
    }
    const next_tile = model.room.draw_pile[0];
    if (next_tile) {
      update["draw_pile"] = model.room.draw_pile.slice(1);
      update[`hands.${model.uid}`] = removeCardFromHand(hand, idx).concat({
        tile: next_tile,
        hints: []
      });
    }
    remote.room.update(update);
  }
  function giveHint(target_prefix: string, hint) {
    if (model.room.state !== ROOM_STATES.WAITING_FOR_PLAYER(model.uid)) {
      return note("not your turn");
    }
    if (model.room.hints === 0) {
      return note("no hints left");
    }
    const matching_players: string[] = _.flatMap(
      model.room.players,
      (player: string) => {
        const name = (model.room.names && model.room.names[player]) || player;
        return player !== model.uid &&
          name.toLowerCase().startsWith(target_prefix.toLowerCase())
          ? [player]
          : [];
      }
    );
    if (matching_players.length === 0) {
      return note("prefix doesn't match any of the others players");
    }
    if (matching_players.length > 1) {
      return note(`prefix matches ${matching_players.length} players`);
    }
    const target_player = matching_players[0];
    if (model.room.players.indexOf(target_player) === -1) {
      return note("no such player");
    }
    const h = hint.toUpperCase(); // canonicalize to uppercase
    if (
      h.length !== 1 ||
      (COLORS.indexOf(h) === -1 && RANKS.indexOf(h) === -1)
    ) {
      return note("invalid hint");
    }
    let update = {};
    update["state"] = ROOM_STATES.WAITING_FOR_PLAYER(
      playerAfter(model.room.players, model.uid)
    );
    update["hints"] = model.room.hints - 1;
    update[`hands.${target_player}`] = applyHintToHand(
      model.room.hands[target_player],
      h
    );
    remote.room.update(update);
    return log(`${model.uid} told ${target_player} about ${hint}`);
  }
  const commands = {
    help: help,
    "?": help,
    name: setName,
    start: startGame,
    hint: giveHint,
    discard: discardTile,
    play: playTile
  };
  function perform(action) {
    if (!model.uid) {
      console.warn("not logged in");
      return false;
    }
    for (let cmd in commands) {
      if (action.startsWith(cmd)) {
        const args = action
          .substring(cmd.length)
          .trim()
          .split(/\s+/);
        commands[cmd].apply(null, args);
        return true;
      }
    }
    console.warn(`${action} does not match any of ${Object.keys(commands)}`);
    return false;
  }

  app.auth().signInAnonymously();
  function handler(evt) {
    if (evt.type !== "keypress") {
      console.warn("event wasn't a keypress, that's surprising");
    }
    const v = evt.srcElement.value;
    if (evt.key === "Enter" && perform(v)) {
      evt.srcElement.value = "";
    }
  }
  m.mount(document.body, model);
});
