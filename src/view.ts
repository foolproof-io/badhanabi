import * as _ from "lodash";
import m from "mithril";
import {
  Tile,
  Hint,
  Color,
  COLORS,
  Rank,
  RANKS,
  UNKNOWN,
  PlayerId,
  Hand,
  HandItem,
  Model,
  Game,
  WaitingArea,
  Controller
} from "./model";
import { rotateToLast } from "./util";
import { summarizePlayPile, matchesHint } from "./logic";

export function viewModel(model: Model, handler: Controller): m.Child {
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
function viewPlayer(player_name: string, hand: Hand): m.Child {
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

function viewAction(text: string, names: any): m.Child {
  return _.reduce(
    names,
    (acc: string, name: string, id: string) => acc.replace(id, name),
    text
  );
}

function redactTiles(hand: Hand): Hand {
  return hand.map(item => (item.tile ? redactTile(item) : item));
}
function redactTile(item: HandItem): HandItem {
  return { tile: UNKNOWN, hints: item.hints };
}

export function viewMarker(hint: Hint): m.Child {
  return m("img", {
    class: "marker",
    src: `./imgs/hints/${hint}.svg`
  });
}
