import * as _ from "lodash";
import m from "mithril";
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';

firebase.initializeApp({
  apiKey: "AIzaSyBIb0BX7QA5K42j12QZH_E3UB8QH_sPpr8",
  projectId: "foolproof-hanabi",
});

enum Color {
  Red = "R",
  Green = "G",
  Blue = "B",
  Yellow = "Y",
  White = "W",
  Purple = "P",
}
const COLORS: Color[] = [
  Color.Red,
  Color.Green,
  Color.Blue,
  Color.Yellow,
  Color.White,
  Color.Purple,
];

enum Rank {
  One = 1,
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
}
const RANKS: Rank[] = [
  Rank.One,
  Rank.Two,
  Rank.Three,
  Rank.Four,
  Rank.Five,
];
const UNKNOWN = "UU";

interface Tile {
  color: Color;
  rank: Rank;
}

function unreachable(_: never) {}

function numTilesInDeck(tile: Tile): number {
  switch (tile.rank) {
    case Rank.One: return 3;
    case Rank.Two: return 2;
    case Rank.Three: return 2;
    case Rank.Four: return 2;
    case Rank.Five: return 1;
  }
}

function generateDeck() {
  let tiles: Tile[] = [];
  for (let color of COLORS) {
    for (let rank of RANKS) {
      const tile: Tile = { color, rank };
      for (let i=0; i < numTilesInDeck(tile); i++) {
        tiles.push(tile)
      }
    }
  }
  return _.shuffle(tiles);
}
function handSize(num_players) {
  switch (num_players) {
    case 2: return 6;
    case 3: return 5;
    case 4: return 4;
    case 5: return 4;
    default: return -1;
  }
}

type Hint = Color | Rank;
interface HeldTile {
  tile?: Tile;
  hints: Hint[];
}
interface HeldHint {
  hint: Hint;
}
type HandItem = HeldTile | HeldHint;

const NUM_INITIAL_HINTS = 8;
function drawTiles(tiles: Tile[], num_tiles: number): HeldTile[] {
  let ts: HeldTile[] = [];
  for (let i=0; i < num_tiles; i++) {
    ts.push({ tile: tiles.pop()!, hints: [] });
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
    const r = Number(tile[1]);
    highest_by_color[c] = Math.max(highest_by_color[c], r);
  });
  return highest_by_color;
}
function isLegalPlay(play_pile, tile) {
  const summary = summarizePlayPile(play_pile);
  const c = tile[0];
  const r = Number(tile[1]);
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
  let minus_card = hand.slice(0, idx).concat(hand.slice(idx+1));
  // trim off any leading hints, they give no information
  while (minus_card.length > 0 && minus_card[0].hint) {
    minus_card.shift();
  }
  return minus_card;
}

function matchesHint(tile, hint) {
  return tile.indexOf(hint) !== -1;
}

const ROOM_STATES = {
  WAITING_TO_START: "waiting to start",
  WAITING_FOR_PLAYER: player => `waiting for ${player}`,
};
function viewModel(model: Model, handler) {
  return m("div", [
    m('div', { id: "whoami", }, `You are: ${model.uid}`),
    m('div', { id: "state", }, model.room.state || "waiting to start"),
    m('div', { id: "draws", }, `Draws: ${(model.room.draw_pile || []).length}`),
    m('div', { id: "hints", }, `Hints: ${model.room.hints}`),
    m('div', { id: "errors", }, `Errors: ${model.room.errors}`),
    m('div', { id: "discards", }, `Discards: ${model.room.discard_pile || []}`),
    m('div', { id: "plays", }, [ "Plays:", viewPlayPile(model.room.play_pile || []) ]),

    m('div', {
      id: "players",
    }, [
      "Players:",
      rotateToLast(model.room.players, model.uid!).map(player => {
        if (!model.room.hands) {
          return m('p', player);
        }
        const hand = model.room.hands.get(player)!;
        const player_view = viewPlayer(player, player === model.uid ? redactTiles(hand) : hand);
        return m('div', {
          class: model.room.state === ROOM_STATES.WAITING_FOR_PLAYER(player) ? "current_player" : "waiting_player",
        }, player_view);
      })
    ]),

    m('input', {
      id: "user_input",
      onchange: handler,
      placeholder: "user_input goes here",
      autofocus: true,
    }),

    m('div', { id: "helptext" }, model.helptext),

    m('div', {
      id: "actions",
    }, model.actions.map(msg => m('p', msg.text))),
  ]);
}
function viewPlayPile(play_pile: Tile[]): m.Child {
  const summary = summarizePlayPile(play_pile);
  return m('table', [
    m('tr', COLORS.map(c => m('td', viewPile(c, summary[c])))),
  ]);
}
function viewPile(color: Color, rank: Color): m.Child {
    return m('img', {
      class: "pile",
      src: `./imgs/piles/${color}${rank}.svg`,
    });
}
function viewPlayer(player_name: PlayerId, hand: HandItem[]): m.Child {
  return m('div', [
    player_name,
    m('table', [
      m('tr', hand.map((item, idx) => m('td', idx))),
      m('tr', hand.map(item => m('td', viewHandItem(item)))),
    ]),
  ]);
}
function viewHandItem(item: HandItem): m.Child {
  return (<HeldTile>item)
    ? viewHeldTile(<HeldTile>item)
    : viewHint((<HeldHint>item).hint);
}
function viewHeldTile(item: HeldTile): m.Child {
  return m('div', [
    m('img', {
      class: "tile",
      src: tileImg(item.tile),
    }),
    m('br'),
    `[${item.hints}]`
  ]);
}
function tileImg(tile?: Tile): string {
  return tile
    ? `./imgs/tiles/${tile.color}${tile.rank}.svg`
    : `./imgs/tiles/UU.svg`;
}


function viewHint(hint: Hint): m.Child {
  return m('p', hint);
}

function rotateToLast<T>(xs: T[], x: T): T[] {
  const idx = xs.indexOf(x);
  return idx === -1
    ? xs
    : xs.slice(idx + 1).concat(xs.slice(0, idx + 1));
}
function redactTiles(hand: HandItem[]): HandItem[] {
  return hand.map(item => (<HeldTile>item) ? redactTile(<HeldTile>item) : item);
}
function redactTile(item: HeldTile): HeldTile {
  return { hints: item.hints };
}

interface Model {
  helptext: string;
  actions: LoggedAction[];
  room: Room;
  uid?: PlayerId;
  view(): m.Child;
}
interface LoggedAction {
  text: string;
}
interface Room {
  state?: GameState;
  players: PlayerId[];
  hands?: Map<PlayerId, HandItem[]>;
  errors?: number;
  hints?: number;
  discard_pile?: Tile[];
  draw_pile?: Tile[];
  play_pile?: Tile[];
}
type GameState = string;
type PlayerId = string;

document.addEventListener('DOMContentLoaded', function() {
  const room_id = window.location.pathname.substring(1);
  let model: Model = {
    actions: [],
    helptext: "try /help",
    room: {
      players: [],
    },
    view: () => viewModel(model, handler),
  };

  const app = firebase.app();
  const remote = {
    room: app.firestore().collection("rooms").doc(room_id),
    actions: app.firestore().collection("rooms").doc(room_id).collection("actions"),
  };
  app.auth().onAuthStateChanged(evt => {
    model.uid = evt!.uid;
    if (model.uid) {
      remote.room.set({
        players: firebase.firestore.FieldValue.arrayUnion(model.uid),
      }, {merge:true});
    }
  });
  remote.room.onSnapshot(snap => {
    if (snap.exists) {
      model.room = snap.data() as any;
      m.redraw();
    }
  });
  remote.actions.orderBy("time", "desc").onSnapshot(snap => {
    model.actions = snap.docs.map(doc => doc.data() as any);
    m.redraw();
  });

  function note(msg) {
    model.helptext = msg;
    return true;
  }
  function log(msg) {
    remote.actions.add({
      time: firebase.firestore.FieldValue.serverTimestamp(),
      text: msg,
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
      return note("this game hasn't started yet, try /start");
    }
    if (model.room.state !== ROOM_STATES.WAITING_FOR_PLAYER(model.uid)) {
      return note("it's not your turn right now");
    }
    return note("you can /discard <tile_idx>, /play <tile_idx>, or /hint <player> <hint>");
  }
  function startGame() {
    if (model.room.state) {
      return note(`game has already started`);
    }

    const hand_size = handSize(model.room.players.length);
    if (hand_size < 0) {
      return note(`wrong number of players, we can support 2--5, you have ${model.room.players.length}`);
    }
    let deck = generateDeck();
    let hands = {};
    model.room.players.forEach(player => {
      hands[player] = drawTiles(deck, hand_size);
    });
    remote.room.update({
      draw_pile: deck,
      discard_pile: [],
      play_pile: [],
      hints: NUM_INITIAL_HINTS,
      errors: 0,
      hands,
      state: ROOM_STATES.WAITING_FOR_PLAYER(model.room.players[0]),
    });
    return log("game has begun!");
  }
  function discardTile(idx_str) {
    if (model.room.state !== ROOM_STATES.WAITING_FOR_PLAYER(model.uid)) {
      return note("not your turn");
    }
    const idx = Number(idx_str);
    const hand = model.room.hands![model.uid!];
    if (!hand[idx] || !hand[idx].tile) {
      return note(`can't discard that, try again`);
    }
    let update = {};
    update["state"] = ROOM_STATES.WAITING_FOR_PLAYER(playerAfter(model.room.players, model.uid));
    update["hints"] = model.room.hints! + 1;
    update["discard_pile"] = model.room.discard_pile!.concat(hand[idx].tile);
    const next_tile = model.room.draw_pile![0];
    let next_hand = removeCardFromHand(hand, idx);
    if (next_tile) {
      update["draw_pile"] = model.room.draw_pile!.slice(1);
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
    const idx = Number(idx_str);
    const hand = model.room.hands![model.uid!];
    if (!hand[idx] || !hand[idx].tile) {
      return note(`can't play that, try again`);
    }
    let update = {};
    update["state"] = ROOM_STATES.WAITING_FOR_PLAYER(playerAfter(model.room.players, model.uid));
    if (isLegalPlay(model.room.play_pile, hand[idx].tile)) {
      update["play_pile"] = model.room.play_pile!.concat(hand[idx].tile);
      log(`${model.uid} played ${hand[idx].tile}`);
      if (hand[idx].tile[1] === "5") {
        update["hints"] = model.room.hints! + 1;
      }
    } else {
      update["errors"] = model.room.errors! + 1;
      update["discard_pile"] = model.room.discard_pile!.concat(hand[idx].tile);
      log(`${model.uid} tried to play ${hand[idx].tile}`);
    }
    const next_tile = model.room.draw_pile![0];
    if (next_tile) {
      update["draw_pile"] = model.room.draw_pile!.slice(1);
      update[`hands.${model.uid}`] = removeCardFromHand(hand, idx).concat({
        tile: next_tile,
        hints: [],
      });
    }
    remote.room.update(update);
  }
  function giveHint(target_prefix, hint) {
    if (model.room.state !== ROOM_STATES.WAITING_FOR_PLAYER(model.uid)) {
      return note("not your turn");
    }
    if (model.room.hints === 0) {
      return note("no hints left");
    }
    const matching_players =
      model.room.players.filter(p =>
        p !== model.uid && p.toLowerCase().startsWith(target_prefix.toLowerCase()));
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
    if (h.length !== 1 || COLORS.indexOf(h) === -1 && RANKS.indexOf(h) === -1) {
      return note("invalid hint");
    }
    let update = {};
    update["state"] = ROOM_STATES.WAITING_FOR_PLAYER(playerAfter(model.room.players, model.uid));
    update["hints"] = model.room.hints! - 1;
    update[`hands.${target_player}`] = applyHintToHand(model.room.hands![target_player], h);
    remote.room.update(update);
    return log(`${model.uid} told ${target_player} about ${hint}`);
  }
  const commands = {
    help: help,
    start: startGame,
    hint: giveHint,
    discard: discardTile,
    play: playTile,
  };
  function perform(action) {
    if (!model.uid) {
      console.warn("not logged in");
      return false;
    }
    for (let cmd in commands) {
      if (action.startsWith(`/${cmd}`)) {
        const args = action.substring(cmd.length + 1).trim().split(/\s+/);
        commands[cmd].apply(null, args);
        return true;
      }
    }
    console.warn(`${action} does not match any of ${Object.keys(commands)}`);
    return false;
  }

  app.auth().signInAnonymously();
  function handler(evt) {
    const v = evt.srcElement.value;
    if (perform(v)) {
      evt.srcElement.value = "";
    } else {
      console.warn("invalid action: ", v);
    }
  }
  m.mount(document.body, model);
});