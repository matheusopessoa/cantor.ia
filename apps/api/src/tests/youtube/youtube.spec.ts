import { describe, expect, it } from "vitest";
import { parseYoutubeVideoId } from "../../utils/youtube.js";

const ID = "dQw4w9WgXcQ";

describe("parseYoutubeVideoId", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?list=PL123&v=${ID}&index=2`,
    `  https://youtu.be/${ID}  `,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])("aceita %s", (url) => {
    expect(parseYoutubeVideoId(url)).toBe(ID);
  });

  it.each([
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `https://evil.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `ftp://www.youtube.com/watch?v=${ID}`,
    `javascript:alert(1)`,
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}`,
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://www.youtube.com/watch?v=abc$defghij`,
    `https://www.youtube.com/watch`,
    `https://www.youtube.com/`,
    `https://youtu.be/`,
    `https://www.youtube.com/channel/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `texto solto`,
    ``,
  ])("recusa %s", (url) => {
    expect(parseYoutubeVideoId(url)).toBeNull();
  });
});
