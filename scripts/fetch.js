const request = require("request");

/**
 * @typedef {string} EmojiLiteral
 * @returns {Promise<{ [githubEmojiId: string]: EmojiLiteral | [string] }>}
 */
async function getGithubEmojiIdMap() {
  return Object.fromEntries(
    Object.entries(
      /** @type {{ [id: string]: string }} */ (await fetchJson(
        "https://api.github.com/emojis",
        {
          headers: {
            "User-Agent": "https://github.com/ikatyang/emoji-cheat-sheet"
          }
        }
      ))
    ).map(([id, url]) => [
      id,
      url.includes("/unicode/")
        ? getLast(url.split("/"))
            .split(".png")[0]
            .split("-")
            .map(codePointText =>
              String.fromCodePoint(Number.parseInt(codePointText, 16))
            )
            .join("")
        : [getLast(url.split("/")).split(".png")[0]] // github's custom emoji
    ])
  );
}

async function getUnicodeEmojiCategoryIterator() {
  return getUnicodeEmojiCategoryIteratorFromText(
    await fetch("https://unicode.org/emoji/charts/full-emoji-list.txt")
  );
}

/**
 * @param {string} text
 */
function* getUnicodeEmojiCategoryIteratorFromText(text) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const value = line.substring(2);
      yield { type: "category", value };
    } else if (line.startsWith("@")) {
      const value = line.substring(1);
      yield { type: "subcategory", value };
    } else if (line.length) {
      const value = line
        .split("\t")[0]
        .split(" ")
        .map(_ => String.fromCodePoint(parseInt(_, 16)))
        .join("");
      yield { type: "emoji", value };
    }
  }
}

async function getCategorizeGithubEmojiIds() {
  const githubEmojiIdMap = await getGithubEmojiIdMap();
  /** @type {{ [emojiLiteral: string]: string[] }} */
  const emojiLiteralToGithubEmojiIdsMap = {};
  /** @type {{ [githubSpecificEmojiUri: string]: string[] }} */
  const githubSpecificEmojiUriToGithubEmojiIdsMap = {};
  for (const [emojiId, emojiLiteral] of Object.entries(githubEmojiIdMap)) {
    if (Array.isArray(emojiLiteral)) {
      const [uri] = emojiLiteral;
      if (!githubSpecificEmojiUriToGithubEmojiIdsMap[uri]) {
        githubSpecificEmojiUriToGithubEmojiIdsMap[uri] = [];
      }
      githubSpecificEmojiUriToGithubEmojiIdsMap[uri].push(emojiId);
      delete githubEmojiIdMap[emojiId];
      continue;
    }
    if (!emojiLiteralToGithubEmojiIdsMap[emojiLiteral]) {
      emojiLiteralToGithubEmojiIdsMap[emojiLiteral] = [];
    }
    emojiLiteralToGithubEmojiIdsMap[emojiLiteral].push(emojiId);
  }
  /** @type {{ [category: string]: { [subcategory: string]: Array<string[]> } }} */
  const categorizedEmojiIds = {};
  const categoryStack = [];
  for (const { type, value } of await getUnicodeEmojiCategoryIterator()) {
    switch (type) {
      case "category": {
        while (categoryStack.length) categoryStack.pop();
        const title = toTitleCase(value);
        categoryStack.push(title);
        categorizedEmojiIds[title] = {};
        break;
      }
      case "subcategory": {
        if (categoryStack.length > 1) categoryStack.pop();
        const title = toTitleCase(value);
        categoryStack.push(title);
        categorizedEmojiIds[categoryStack[0]][title] = [];
        break;
      }
      case "emoji": {
        const key = value.replace(/[\ufe00-\ufe0f\u200d]/g, "");
        if (key in emojiLiteralToGithubEmojiIdsMap) {
          const githubEmojiIds = emojiLiteralToGithubEmojiIdsMap[key];
          const [category, subcategory] = categoryStack;
          categorizedEmojiIds[category][subcategory].push(githubEmojiIds);
          for (const githubEmojiId of githubEmojiIds) {
            delete githubEmojiIdMap[githubEmojiId];
          }
        }
        break;
      }
      default:
        throw new Error(`Unexpected type ${JSON.stringify(type)}`);
    }
  }
  if (Object.keys(githubEmojiIdMap).length) {
    throw new Error(`Uncategorized emoji(s) found.`);
  }
  for (const category of Object.keys(categorizedEmojiIds)) {
    const subCategorizedEmojiIds = categorizedEmojiIds[category];
    const subcategories = Object.keys(subCategorizedEmojiIds);
    for (const subcategory of subcategories) {
      if (subCategorizedEmojiIds[subcategory].length === 0) {
        delete subCategorizedEmojiIds[subcategory];
      }
    }
    if (Object.keys(subCategorizedEmojiIds).length === 0) {
      delete categorizedEmojiIds[category];
    }
  }
  if (Object.keys(githubSpecificEmojiUriToGithubEmojiIdsMap).length) {
    categorizedEmojiIds["GitHub Custom Emoji"] = {
      "": Object.entries(githubSpecificEmojiUriToGithubEmojiIdsMap).map(
        ([, v]) => v
      )
    };
  }
  return categorizedEmojiIds;
}

/**
 * @param {string} str
 */
function toTitleCase(str) {
  return str
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[a-zA-Z]+/g, word => word[0].toUpperCase() + word.slice(1));
}

/**
 * @template T
 * @param {Array<T>} array
 */
function getLast(array) {
  return array[array.length - 1];
}

/**
 * @param {string} url
 * @param {Partial<request.Options>} options
 * @returns {Promise<any>}
 */
async function fetchJson(url, options = {}) {
  return JSON.parse(await fetch(url, options));
}

/**
 * @param {string} url
 * @param {Partial<request.Options>} options
 * @returns {Promise<string>}
 */
async function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    request.get(
      /** @type {request.Options} */ ({ url, ...options }),
      (error, response, html) => {
        if (!error && response.statusCode === 200) {
          resolve(html);
        } else {
          reject(
            error
              ? error
              : `Unexpected response status code: ${response.statusCode}`
          );
        }
      }
    );
  });
}

module.exports = {
  getCategorizeGithubEmojiIds
};