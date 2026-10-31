import { expect, it } from "vitest";
import { matchSlashCommands, slashCommandQuery } from "../src";

it("matches command names and Chinese labels only for a complete slash query", () => {
  expect(matchSlashCommands(slashCommandQuery("/EXPL"))[0].name).toBe(
    "explain",
  );
  expect(matchSlashCommands(slashCommandQuery("/压缩"))[0].prompt).toBe(
    "/compact",
  );
  expect(matchSlashCommands(slashCommandQuery("/explain text"))).toEqual([]);
  expect(matchSlashCommands(slashCommandQuery("text /explain"))).toEqual([]);
});
