import * as _ from "lodash";
import m from "mithril";
import * as firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";
import { strictParse } from "./util";

type PlayerId = string;

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
type Hand = HandItem[];

interface Controller {
  onTextInput(evt: any): void;
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
function handSize(num_players: number): number {
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

function playerAfter(players: PlayerId[], p: PlayerId): PlayerId {
  const idx = players.indexOf(p);
  return players[(idx + 1) % players.length];
}

function summarizePlayPile(play_pile: Tile[]): object {
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
function isLegalPlay(play_pile: Tile[], tile: Tile): boolean {
  const summary = summarizePlayPile(play_pile);
  const c = tile[0];
  const r = strictParse(tile[1]);
  return r === summary[c] + 1;
}
function applyHintToHand(hand: HandItem[], hint: Hint): HandItem[] {
  let applied = hand.map(item => {
    if (item.tile && item.hints && matchesHint(item.tile, hint)) {
      item.hints.push(hint);
    }
    return item;
  });
  applied.push({ hint });
  return applied;
}

function removeCardFromHand(hand: HandItem[], idx: number): HandItem[] {
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

interface Model {
  uid?: PlayerId;
  helptext?: string;
  room?: WaitingArea | Game;
  actions?: LoggedAction[];
}

interface WaitingArea {
  tag: "waiting_area";
  viewers: PlayerId[];
  names: { [id: string]: string };
}

interface Game {
  tag: "game";
  viewers: PlayerId[];
  names: { [id: string]: string };
  turn: PlayerId;
  players: PlayerId[];
  draw_pile: Tile[];
  play_pile: Tile[];
  discard_pile: Tile[];
  hints: number;
  errors: number;
  hands: { [id: string]: Hand };
}

interface LoggedAction {
  text: string;
}

function viewModel(model: Model, handler: Controller): m.Child {
  if (!model.uid) {
    return m("div", {}, "waiting to generate a user id...");
  }
  const uid = model.uid;

  if (!model.room) {
    return m("div", {}, "waiting to retrieve information about this room...");
  }
  const room = model.room;

  return m("div", [
    viewRoom(uid, room),
    m("input", {
      id: "user_input",
      onkeypress: handler.onTextInput,
      placeholder: "user_input goes here",
      autofocus: true
    }),

    m("div", { id: "helptext" }, model.helptext),
    m(
      "ol",
      {
        id: "actions",
        reversed: true
      },
      (model.actions || []).map(msg =>
        m("li", viewAction(msg.text, room.names))
      )
    )
  ]);
}

function viewRoom(uid: PlayerId, room: WaitingArea | Game): m.Child {
  switch (room.tag) {
    case "waiting_area":
      return viewWaitingArea(room);
    case "game":
      return viewGame(uid, room);
  }
}

function viewWaitingArea(room: WaitingArea): m.Child {
  return m(
    "div",
    {},
    room.viewers.map(id => m("p", (room.names && room.names[id]) || id))
  );
}

function viewGame(uid: PlayerId, game: Game): m.Child {
  return m("div", [
    m("div", { id: "draws" }, `Draws: ${(game.draw_pile || []).length}`),
    m("div", { id: "hints" }, `Hints: ${game.hints}`),
    m("div", { id: "errors" }, `Errors: ${game.errors}`),
    m("div", { id: "discards" }, [
      "Discards:",
      viewDiscardPile(game.discard_pile || [])
    ]),
    m("div", { id: "plays" }, ["Plays:", viewPlayPile(game.play_pile || [])]),

    m(
      "div",
      {
        id: "players"
      },
      [
        "Players:",
        rotateToLast(game.players, uid).map(player => {
          const name = (game.names && game.names[player]) || player;
          const hand = game.hands[player];
          const player_view = viewPlayer(
            name,
            player === uid ? redactTiles(hand) : hand
          );
          return m(
            "div",
            {
              class: game.turn === player ? "current_player" : "waiting_player"
            },
            player_view
          );
        })
      ]
    )
  ]);
}
function viewDiscardPile(discard_pile: Tile[]): m.Child {
  return m(
    "table",
    {},
    COLORS.map(color => {
      const tiles = discard_pile.filter(t => matchesHint(t, color)).sort();
      return m("tr", tiles.map(t => m("td", viewDiscardedTile(t))));
    })
  );
}
function viewDiscardedTile(tile: Tile): m.Child {
  return m("img", {
    class: "discard",
    src: `./imgs/tiles/${tile}.svg`
  });
}
function viewPlayPile(play_pile: Tile[]): m.Child {
  const summary = summarizePlayPile(play_pile);
  return m("table", [
    m("tr", COLORS.map(c => m("td", viewPile(c, summary[c]))))
  ]);
}
function viewPile(color: Color, rank: Rank): m.Child {
  return m("img", {
    class: "pile",
    src: `./imgs/piles/${color}${rank}.svg`
  });
}
function viewPlayer(player_name: string, hand: HandItem[]): m.Child {
  return m("div", [
    player_name,
    m("table", [
      m("tr", hand.map((item, idx) => m("td", idx))),
      m("tr", hand.map(item => m("td", viewHandItem(item)))),
      m("tr", hand.map(item => m("td", viewTileHints(item.hints || []))))
    ])
  ]);
}
function viewHandItem(item: HandItem): m.Child {
  return item.tile ? viewTile(item.tile) : viewMarker(item.hint!);
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

function viewAction(text: string, names: any): m.Child {
  return _.reduce(
    names,
    (acc: string, name: string, id: string) => acc.replace(id, name),
    text
  );
}

function rotateToLast<T>(xs: T[], x: T): T[] {
  const idx = xs.indexOf(x);
  return idx === -1 ? xs : xs.slice(idx + 1).concat(xs.slice(0, idx + 1));
}
function redactTiles(hand: HandItem[]): HandItem[] {
  return hand.map(item => (item.tile ? redactTile(item) : item));
}
function redactTile(item: HandItem): HandItem {
  return { tile: UNKNOWN, hints: item.hints };
}
document.addEventListener("DOMContentLoaded", function() {
  firebase.initializeApp({
    apiKey: "AIzaSyBIb0BX7QA5K42j12QZH_E3UB8QH_sPpr8",
    projectId: "foolproof-hanabi"
  });
  const room_id = window.location.pathname.substring(1);
  let model: Model = {
    actions: [],
    helptext: "try 'help' or '?'"
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
    const data = snap.data();
    if (!data) {
      model.room = undefined;
    } else if ("turn" in data) {
      model.room = data as Game;
      model.room.tag = "game";
    } else {
      model.room = data as WaitingArea;
      model.room.tag = "waiting_area";
    }
    m.redraw();
  });
  remote.actions.orderBy("time", "desc").onSnapshot(snap => {
    model.actions = snap.docs.map(doc => doc.data() as LoggedAction);
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
    switch (model.room.tag) {
      case "waiting_area":
        return note("this game hasn't started yet, try 'start'");
      case "game":
        return note(
          "you can 'discard <tile_idx>', 'play <tile_idx>', or 'hint <player> <hint>'"
        );
    }
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
  }
  function startGame() {
    if (!model.room) {
      return note(`waiting to load room`);
    }
    if (model.room.tag === "game") {
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
      turn: players[0]
    });
    return log("game has begun!");
  }
  function discardTile(idx_str) {
    if (!model.uid || !model.room || model.room.tag === "waiting_area") {
      return note(`game has not yet started...`);
    }
    if (model.room.turn !== model.uid) {
      return note("not your turn");
    }
    const idx = strictParse(idx_str);
    const hand: Hand = model.room.hands[model.uid];
    const item: HandItem = hand[idx];
    if (!item || !item.tile) {
      return note(`can't discard that, try again`);
    }
    let update = {};
    update["turn"] = playerAfter(model.room.players, model.uid);
    update["hints"] = Math.min(model.room.hints + 1, NUM_INITIAL_HINTS);
    update["discard_pile"] = model.room.discard_pile.concat(item.tile);
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
    if (!model.uid || !model.room || model.room.tag === "waiting_area") {
      return note(`game has not yet started...`);
    }
    if (model.room.turn !== model.uid) {
      return note("not your turn");
    }
    const idx = strictParse(idx_str);
    const hand = model.room.hands[model.uid];
    const item: HandItem = hand[idx];
    if (!item || !item.tile) {
      return note(`can't play that, try again`);
    }
    let update = {};
    update["turn"] = playerAfter(model.room.players, model.uid);
    if (isLegalPlay(model.room.play_pile, item.tile)) {
      update["play_pile"] = model.room.play_pile.concat(item.tile);
      log(`${model.uid} played ${hand[idx].tile}`);
      if (item.tile[1] === "5") {
        update["hints"] = model.room.hints + 1;
      }
    } else {
      update["errors"] = model.room.errors + 1;
      update["discard_pile"] = model.room.discard_pile.concat(item.tile);
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
  function giveHint(target_prefix: string, hint: string) {
    if (!model.uid || !model.room || model.room.tag === "waiting_area") {
      return note(`game has not yet started...`);
    }
    const game: Game = model.room;
    if (game.turn !== model.uid) {
      return note("not your turn");
    }
    if (game.hints === 0) {
      return note("no hints left");
    }
    const matching_players: string[] = _.flatMap(
      game.players,
      (player: string) => {
        const name = game.names[player] || player;
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
    if (game.players.indexOf(target_player) === -1) {
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
    update["turn"] = playerAfter(game.players, model.uid);
    update["hints"] = game.hints - 1;
    update[`hands.${target_player}`] = applyHintToHand(
      game.hands[target_player],
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
    return false;
  }

  app.auth().signInAnonymously();
  const controller: Controller = {
    onTextInput: evt => {
      if (evt.type !== "keypress") {
        console.warn("event wasn't a keypress, that's surprising");
      }
      const v = evt.srcElement.value;
      if (evt.key === "Enter" && perform(v)) {
        evt.srcElement.value = "";
      }
    }
  };

  m.mount(document.body, { view: () => viewModel(model, controller) });
});
