import * as _ from "lodash";
import m from "mithril";
import firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";
import { strictParse, itemAfter } from "./util";
import {
  generateDeck,
  applyHintToHand,
  isLegalPlay,
  handSize,
  removeCardFromHand,
  drawTiles,
  NUM_INITIAL_HINTS
} from "./logic";
import {
  COLORS,
  RANKS,
  Hand,
  HandItem,
  Model,
  Game,
  WaitingArea,
  LoggedAction,
  Controller
} from "./model";
import { viewModel } from "./view";

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

  function note(msg: string): boolean {
    model.helptext = msg;
    return true;
  }
  function log(msg: string): boolean {
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
    update["turn"] = itemAfter(model.uid, model.room.players);
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
    const hand: Hand = model.room.hands[model.uid];
    const item: HandItem = hand[idx];
    if (!item || !item.tile) {
      return note(`can't play that, try again`);
    }
    let update = {};
    update["turn"] = itemAfter(model.uid, model.room.players);
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
    update["turn"] = itemAfter(model.uid, game.players);
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
