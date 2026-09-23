#!/usr/bin/env node
// PreToolUse: validate a deliberate model/effort allocation against the
// dispatch surface. No provider calls, prompt rewrites, delivery receipts,
// or workflow enforcement. Unknown tools and malformed hook envelopes pass.
// The best-effort log records an allowed request, not proof a child started.
let record = () => {};
let clip = (value, max = 120) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};
try {
  ({ record, clip } = require("./run-log.js"));
} catch {}

function shellTokens(command) {
  const tokens = [];
  let word = "";
  let wordStarted = false;
  let quote = "";
  let doubleQuoteSubstitution = null;
  let doubleQuoteSubstitutionDepth = 0;
  let caseDepth = 0;
  let caseAwaitingIn = false;
  let casePattern = false;
  let escaped = false;
  const flush = () => {
    if (word && doubleQuoteSubstitution === "paren") {
      if (word === "case") {
        caseDepth += 1;
        caseAwaitingIn = true;
        casePattern = false;
      } else if (caseDepth > 0 && caseAwaitingIn && word === "in") {
        caseAwaitingIn = false;
        casePattern = true;
      } else if (caseDepth > 0 && word === "esac") {
        caseDepth -= 1;
        caseAwaitingIn = false;
        casePattern = false;
      }
    }
    if (word) tokens.push({ kind: "word", value: word });
    word = "";
    wordStarted = false;
  };
  const source = maskHeredocBodies(String(command || ""));
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      wordStarted = true;
      if (char !== "\n" && !(char === "\r" && source[index + 1] === "\n")) word += char;
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      escaped = false;
    } else if (char === "\\") {
      wordStarted = true;
      const next = source[index + 1];
      if (next && /[\s'"\\;|&#$`(){}]/.test(next)) escaped = true;
      else word += char;
    } else if (quote) {
      if (quote === '"' && char === "$" && source[index + 1] === "(") {
        flush();
        tokens.push({ kind: "separator", value: "$(" });
        doubleQuoteSubstitution = "paren";
        doubleQuoteSubstitutionDepth = 1;
        quote = "";
        index += 1;
      } else if (quote === '"' && char === "`") {
        flush();
        tokens.push({ kind: "separator", value: "`" });
        doubleQuoteSubstitution = "backtick";
        quote = "";
      } else if (char === quote) quote = "";
      else {
        wordStarted = true;
        word += char;
      }
    } else if (char === "'" || char === '"') {
      wordStarted = true;
      quote = char;
    } else if (char === "#" && !word && !wordStarted) {
      // A comment starts only at a word boundary. Ignore it until the next
      // line so commented-out examples cannot become audit records.
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
    } else if (/\s/.test(char)) {
      flush();
      if (char === "\n") tokens.push({ kind: "separator", value: "\n" });
    } else if (doubleQuoteSubstitution === "paren" && char === "$" && source[index + 1] === "(") {
      flush();
      tokens.push({ kind: "separator", value: "$(" });
      doubleQuoteSubstitutionDepth += 1;
      index += 1;
    } else if (doubleQuoteSubstitution === "paren" && char === "(") {
      flush();
      tokens.push({ kind: "separator", value: "(" });
      doubleQuoteSubstitutionDepth += 1;
    } else if (doubleQuoteSubstitution === "paren" && char === ")") {
      flush();
      tokens.push({ kind: "separator", value: ")" });
      if (doubleQuoteSubstitutionDepth === 1 && caseDepth > 0 && casePattern) {
        casePattern = false;
      } else {
        doubleQuoteSubstitutionDepth -= 1;
        if (doubleQuoteSubstitutionDepth === 0) {
          doubleQuoteSubstitution = null;
          caseDepth = 0;
          caseAwaitingIn = false;
          casePattern = false;
          quote = '"';
        }
      }
    } else if (doubleQuoteSubstitution === "backtick" && char === "`") {
      flush();
      tokens.push({ kind: "separator", value: "`" });
      doubleQuoteSubstitution = null;
      quote = '"';
    } else if (char === "<" || char === ">") {
      flush();
      let operator = char;
      if (source[index + 1] === char) {
        operator += char;
        index += 1;
      }
      if (source[index + 1] === "&") {
        operator += "&";
        index += 1;
      }
      tokens.push({ kind: "redirection", value: operator });
    } else if (char === ";" || char === "|" || char === "&" || char === "(" || char === ")" || char === "{" || char === "}" || char === "`") {
      flush();
      tokens.push({ kind: "separator", value: char });
      if (doubleQuoteSubstitution === "paren" && doubleQuoteSubstitutionDepth === 1 && caseDepth > 0 && char === ";" && source[index + 1] === ";") casePattern = true;
    } else {
      wordStarted = true;
      word += char;
    }
  }
  if (escaped) word += "\\";
  flush();
  return stripUninvokedFunctionDefinitions(tokens);
}

function isSeparator(token, value) {
  return token?.kind === "separator" && token.value === value;
}

function functionDefinitionEnd(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (isSeparator(tokens[index], "{")) depth += 1;
    else if (isSeparator(tokens[index], "}")) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripUninvokedFunctionDefinitions(tokens) {
  const definitions = [];
  for (let index = 0; index < tokens.length - 3; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "word") continue;
    if (isSeparator(tokens[index + 1], "(") && isSeparator(tokens[index + 2], ")") && isSeparator(tokens[index + 3], "{")) {
      const end = functionDefinitionEnd(tokens, index + 3);
      if (end >= 0) definitions.push({ name: token.value, start: index, end });
      continue;
    }
    if (token.value !== "function" || tokens[index + 1]?.kind !== "word") continue;
    const open = tokens.findIndex((candidate, candidateIndex) => candidateIndex > index + 1 && isSeparator(candidate, "{"));
    if (open < 0) continue;
    const end = functionDefinitionEnd(tokens, open);
    if (end >= 0) definitions.push({ name: tokens[index + 1].value, start: index, end });
  }
  if (!definitions.length) return tokens;
  const insideDefinition = (index) => definitions.some(({ start, end }) => index >= start && index <= end);
  const uninvoked = definitions.filter(({ name }) => !tokens.some((token, index) => {
    if (insideDefinition(index) || token?.kind !== "word" || token.value !== name) return false;
    const previous = tokens[index - 1];
    return !previous || previous.kind === "separator" || (previous.kind === "word" && SHELL_CONTROL_WORDS.has(previous.value));
  }));
  if (!uninvoked.length) return tokens;
  const result = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const definition = uninvoked.find(({ start }) => start === index);
    if (!definition) {
      result.push(tokens[index]);
      continue;
    }
    if (result.length && result.at(-1).kind !== "separator" && tokens[definition.end + 1]?.kind !== "separator") result.push({ kind: "separator", value: ";" });
    index = definition.end;
  }
  return result;
}

function isAssignment(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function basename(value) {
  return value.split(/[\\/]/).pop();
}

const SHELL_CONTROL_WORDS = new Set(["if", "then", "elif", "else", "while", "until", "do", "!", "coproc"]);
const SHELL_LAUNCHERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const MAX_SHELL_WRAPPER_DEPTH = 4;

function heredocSpecs(line) {
  const specs = [];
  let quote = "";
  let escaped = false;
  let arithmeticDepth = 0;
  let arithmeticReturnQuote = "";
  const parenFrames = [];
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (arithmeticDepth) {
      if (char === "(") arithmeticDepth += 1;
      else if (char === ")") arithmeticDepth -= 1;
      if (arithmeticDepth === 0) quote = arithmeticReturnQuote;
      continue;
    }
    if (quote) {
      if (quote === '"' && char === "$" && line[index + 1] === "(") {
        arithmeticReturnQuote = quote;
        quote = "";
        if (line[index + 2] === "(") {
          arithmeticDepth = 2;
          index += 2;
        } else {
          parenFrames.push(arithmeticReturnQuote);
          index += 1;
        }
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "$" && line[index + 1] === "(") {
      arithmeticReturnQuote = "";
      if (line[index + 2] === "(") {
        arithmeticDepth = 2;
        index += 2;
      } else {
        parenFrames.push("");
        index += 1;
      }
      continue;
    }
    if (parenFrames.length && char === "(") {
      parenFrames.push(null);
      continue;
    }
    if (parenFrames.length && char === ")") {
      const returnQuote = parenFrames.pop();
      if (returnQuote !== null) quote = returnQuote;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) break;
    if (char !== "<" || line[index + 1] !== "<" || line[index + 2] === "<") continue;
    let cursor = index + 2;
    const stripTabs = line[cursor] === "-";
    if (stripTabs) cursor += 1;
    while (/\s/.test(line[cursor] || "")) cursor += 1;
    let delimiter = "";
    let quoted = false;
    let delimiterQuote = "";
    let delimiterEscaped = false;
    while (cursor < line.length) {
      const char = line[cursor];
      if (delimiterEscaped) {
        delimiter += char;
        delimiterEscaped = false;
        quoted = true;
        cursor += 1;
        continue;
      }
      if (delimiterQuote) {
        if (char === delimiterQuote) delimiterQuote = "";
        else delimiter += char;
        quoted = true;
        cursor += 1;
        continue;
      }
      if (char === "\\") {
        delimiterEscaped = true;
        quoted = true;
        cursor += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        delimiterQuote = char;
        quoted = true;
        cursor += 1;
        continue;
      }
      if (/[\s;|&<>()[\]{}]/.test(char)) break;
      delimiter += char;
      cursor += 1;
    }
    if (delimiter) specs.push({ delimiter, stripTabs, quoted });
    index = Math.max(index, cursor - 1);
  }
  return specs;
}

function maskHeredocExpansions(line, state) {
  const masked = line.replace(/[^\r]/g, " ").split("");
  const preserve = (index) => { masked[index] = line[index]; };
  state.caseDepth ??= 0;
  state.caseAwaitingIn ??= false;
  state.casePattern ??= false;
  state.word ??= "";
  const flushWord = () => {
    if (state.word === "case") {
      state.caseDepth += 1;
      state.caseAwaitingIn = true;
      state.casePattern = false;
    } else if (state.caseDepth > 0 && state.caseAwaitingIn && state.word === "in") {
      state.caseAwaitingIn = false;
      state.casePattern = true;
    } else if (state.caseDepth > 0 && state.word === "esac") {
      state.caseDepth -= 1;
      state.caseAwaitingIn = false;
      state.casePattern = false;
    }
    state.word = "";
  };
  for (let index = 0; index < line.length; index += 1) {
    if (state.mode === "paren") {
      preserve(index);
      const char = line[index];
      if (state.escaped) {
        state.escaped = false;
      } else if (char === "\\") {
        state.escaped = true;
      } else if (state.quote) {
        if (char === state.quote) state.quote = "";
      } else if (char === "'" || char === '"') {
        flushWord();
        state.quote = char;
      } else if (char === "(") {
        flushWord();
        state.depth += 1;
      } else if (char === ")") {
        flushWord();
        if (state.depth === 1 && state.caseDepth > 0 && state.casePattern) {
          state.casePattern = false;
        } else {
          state.depth -= 1;
          if (state.depth === 0) {
            state.mode = null;
            state.caseDepth = 0;
            state.caseAwaitingIn = false;
            state.casePattern = false;
          }
        }
      } else if (/\s/.test(char)) {
        flushWord();
      } else if (char === ";" || char === "|" || char === "&") {
        flushWord();
        if (char === ";" && line[index + 1] === ";" && state.depth === 1 && state.caseDepth > 0) state.casePattern = true;
      } else {
        state.word += char;
      }
    } else if (state.mode === "backtick") {
      preserve(index);
      if (state.escaped) {
        state.escaped = false;
      } else if (line[index] === "\\") {
        state.escaped = true;
      } else if (line[index] === "`") {
        state.mode = null;
      }
    } else if (line[index] === "$" && line[index + 1] === "(") {
      preserve(index);
      preserve(index + 1);
      state.mode = "paren";
      state.depth = 1;
      state.quote = "";
      state.escaped = false;
      index += 1;
    } else if (line[index] === "`") {
      preserve(index);
      state.mode = "backtick";
      state.escaped = false;
    }
  }
  return masked.join("");
}

function maskHeredocBodies(source) {
  const lines = source.split("\n");
  const pending = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (pending.length) {
      const comparable = line.endsWith("\r") ? line.slice(0, -1) : line;
      const expected = pending[0];
      if (comparable === expected.delimiter || (expected.stripTabs && comparable.replace(/^\t+/, "") === expected.delimiter)) pending.shift();
      lines[index] = expected.quoted
        ? line.replace(/[^\r]/g, " ")
        : maskHeredocExpansions(line, expected.expansionState ||= { mode: null, depth: 0, quote: "", escaped: false });
      continue;
    }
    let slashCount = 0;
    const end = line.endsWith("\r") ? line.length - 2 : line.length - 1;
    while (end - slashCount >= 0 && line[end - slashCount] === "\\") slashCount += 1;
    while (slashCount % 2 === 1 && index + 1 < lines.length) {
      line = line.replace(/\\\r?$/, "") + lines[++index];
      slashCount = 0;
      const nextEnd = line.endsWith("\r") ? line.length - 2 : line.length - 1;
      while (nextEnd - slashCount >= 0 && line[nextEnd - slashCount] === "\\") slashCount += 1;
    }
    pending.push(...heredocSpecs(line));
  }
  return lines.join("\n");
}

function skipRedirection(tokens, cursor, index) {
  if (tokens[cursor]?.kind === "word" && /^\d+$/.test(tokens[cursor].value) && tokens[cursor + 1]?.kind === "redirection") cursor += 1;
  if (tokens[cursor]?.kind !== "redirection") return null;
  cursor += 1;
  if (cursor < index && tokens[cursor]?.kind === "word") cursor += 1;
  return cursor;
}

function envOptionAdvance(value) {
  if (value === "-S" || value === "--split-string") return 2;
  if (value.startsWith("--split-string=")) return 1;
  if (value === "-u" || value === "--unset" || value === "-C" || value === "--chdir") return 2;
  if (value.startsWith("--unset=") || (value.startsWith("-u") && value.length > 2)) return 1;
  if (value.startsWith("--chdir=") || (value.startsWith("-C") && value.length > 2)) return 1;
  if (value === "-i" || value === "--ignore-environment" || value === "--list-signal-handling" || value === "-v" || value === "--debug") return 1;
  if (["--block-signal", "--default-signal", "--ignore-signal"].includes(value)) return 1;
  if (["--block-signal=", "--default-signal=", "--ignore-signal="].some((prefix) => value.startsWith(prefix))) return 1;
  return 0;
}

function skipStdbufOptions(values, cursor, end) {
  cursor += 1;
  const optionsWithArguments = new Set(["-i", "--input", "-o", "--output", "-e", "--error"]);
  while (cursor < end) {
    const token = values[cursor];
    const value = typeof token === "string" ? token : token?.kind === "word" ? token.value : undefined;
    if (value === undefined) break;
    if (value === "--") return cursor + 1;
    if (optionsWithArguments.has(value)) {
      cursor += 2;
      continue;
    }
    if (/^(?:--input|--output|--error)=/.test(value) || /^-[ioe].+/.test(value) || value.startsWith("-")) {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

function skipSetsidOptions(values, cursor, end) {
  cursor += 1;
  while (cursor < end) {
    const token = values[cursor];
    const value = typeof token === "string" ? token : token?.kind === "word" ? token.value : undefined;
    if (value === undefined) break;
    if (value === "--") return cursor + 1;
    if (value.startsWith("-")) {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

function skipXargsOptions(values, cursor, end) {
  cursor += 1;
  const optionsWithArguments = new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]);
  while (cursor < end) {
    const token = values[cursor];
    const value = typeof token === "string" ? token : token?.kind === "word" ? token.value : undefined;
    if (value === undefined) break;
    if (value === "--") return cursor + 1;
    if (!value.startsWith("-")) break;
    cursor += 1;
    if (optionsWithArguments.has(value)) cursor += 1;
  }
  return cursor;
}

const CODEX_GLOBAL_VALUE_OPTIONS = new Set([
  "-c", "--config", "--enable", "--disable", "--remote", "--remote-auth-token-env",
  "-i", "--image", "-m", "--model", "--local-provider", "-p", "--profile",
  "-s", "--sandbox", "-a", "--ask-for-approval", "-C", "--cd", "--add-dir",
]);

function codexConfigValue(value) {
  const match = String(value || "").match(/^(model|model_reasoning_effort|model_provider)\s*=\s*(.+)$/);
  if (!match) return {};
  const key = { model: "configModel", model_reasoning_effort: "effort", model_provider: "provider" }[match[1]];
  return { [key]: match[2].replace(/^(['"])(.*)\1$/, "$2") };
}

function codexExecStart(tokens, index) {
  let cursor = index + 1;
  const allocation = {};
  while (cursor < tokens.length && tokens[cursor].kind === "word") {
    const value = tokens[cursor].value;
    const next = tokens[cursor + 1]?.value;
    if (value === "exec") return { index: cursor, ...allocation };
    if (value === "--") return null;
    if (value === "-m" || value === "--model") {
      allocation.flagModel = next;
      cursor += 2;
      continue;
    }
    if (value.startsWith("--model=")) {
      allocation.flagModel = value.slice("--model=".length);
      cursor += 1;
      continue;
    }
    if (value === "-c" || value === "--config") {
      Object.assign(allocation, codexConfigValue(next));
      cursor += 2;
      continue;
    }
    if (value.startsWith("--config=")) {
      Object.assign(allocation, codexConfigValue(value.slice("--config=".length)));
      cursor += 1;
      continue;
    }
    if (value === "--local-provider") {
      allocation.provider = next;
      cursor += 2;
      continue;
    }
    if (value.startsWith("--local-provider=")) {
      allocation.provider = value.slice("--local-provider=".length);
      cursor += 1;
      continue;
    }
    if (CODEX_GLOBAL_VALUE_OPTIONS.has(value)) {
      cursor += 2;
      continue;
    }
    if (value.startsWith("-")) {
      cursor += 1;
      continue;
    }
    return null;
  }
  return null;
}

function commandPrefixAllows(tokens, index) {
  let start = index;
  while (start > 0 && tokens[start - 1].kind !== "separator") start -= 1;
  let cursor = start;
  while (cursor < index) {
    const afterRedirection = skipRedirection(tokens, cursor, index);
    if (afterRedirection !== null) {
      cursor = afterRedirection;
      continue;
    }
    while (cursor < index && tokens[cursor].kind === "word" && isAssignment(tokens[cursor].value)) cursor += 1;
    if (cursor >= index || tokens[cursor].kind !== "word") break;
    if (SHELL_CONTROL_WORDS.has(tokens[cursor].value)) {
      cursor += 1;
      continue;
    }
    const launcher = basename(tokens[cursor].value);
    if (launcher === "env") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-i" || value === "--ignore-environment") {
          cursor += 1;
          continue;
        }
        const optionAdvance = envOptionAdvance(value);
        if (optionAdvance) {
          cursor += optionAdvance;
          continue;
        }
        if (isAssignment(value)) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "exec") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-a") {
          cursor += 2;
          continue;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "command") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word" && ["-p", "--"].includes(tokens[cursor].value)) cursor += 1;
      continue;
    }
    if (launcher === "timeout") {
      cursor += 1;
      const optionsWithArguments = new Set(["-k", "--kill-after", "-s", "--signal"]);
      while (cursor < index && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          if (optionsWithArguments.has(value) && cursor < index) cursor += 1;
          continue;
        }
        cursor += 1; // timeout duration
        break;
      }
      continue;
    }
    if (launcher === "nohup") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word" && (tokens[cursor].value === "--" || tokens[cursor].value.startsWith("-"))) cursor += 1;
      continue;
    }
    if (launcher === "time") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word" && tokens[cursor].value.startsWith("-")) {
        const value = tokens[cursor].value;
        cursor += 1;
        if (["-f", "--format", "-o", "--output"].includes(value) && cursor < index) cursor += 1;
      }
      continue;
    }
    if (launcher === "nice") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-n" || value === "--adjustment") {
          cursor += 2;
          continue;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "stdbuf") {
      cursor = skipStdbufOptions(tokens, cursor, index);
      continue;
    }
    if (launcher === "setsid") {
      cursor = skipSetsidOptions(tokens, cursor, index);
      continue;
    }
    if (launcher === "xargs") {
      cursor = skipXargsOptions(tokens, cursor, tokens.length);
      continue;
    }
    if (launcher === "find") {
      cursor += 1;
      while (cursor < index) {
        if (tokens[cursor]?.kind !== "word") {
          cursor += 1;
          continue;
        }
        if (tokens[cursor].value === "-exec" || tokens[cursor].value === "-execdir") {
          cursor += 1;
          const actionStart = cursor;
          while (cursor < index && tokens[cursor]?.kind === "word" && ![";", "+"].includes(tokens[cursor].value)) cursor += 1;
          if (cursor >= index) {
            const actionPrefix = tokens.slice(actionStart, index);
            return commandPrefixAllows([...actionPrefix, tokens[index]], index - actionStart);
          }
          if (cursor < index) cursor += 1;
          continue;
        }
        cursor += 1;
      }
      continue;
    }
    break;
  }
  return cursor === index;
}

function shellWrapperTokens(tokens, depth = 0) {
  if (depth >= MAX_SHELL_WRAPPER_DEPTH) return tokens;
  const separatorIndex = tokens.findIndex((token) => token.kind === "separator");
  if (separatorIndex >= 0) {
    const head = tokens.slice(0, separatorIndex);
    const separator = tokens[separatorIndex];
    const tail = tokens.slice(separatorIndex + 1);
    return [...shellWrapperTokens(head, depth), separator, ...shellWrapperTokens(tail, depth)];
  }
  let cursor = 0;
  while (cursor < tokens.length) {
    const afterRedirection = skipRedirection(tokens, cursor, tokens.length);
    if (afterRedirection !== null) {
      cursor = afterRedirection;
      continue;
    }
    if (tokens[cursor]?.kind !== "word") break;
    const launcher = basename(tokens[cursor].value).toLowerCase();
    if (isAssignment(tokens[cursor].value)) {
      cursor += 1;
      continue;
    }
    if (launcher === "env") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-i" || value === "--ignore-environment" || isAssignment(value)) {
          cursor += 1;
          continue;
        }
        if (value === "-S" || value === "--split-string") {
          const payload = tokens[cursor + 1];
          if (payload?.kind !== "word") return tokens;
          const nested = shellWrapperTokens(shellTokens(payload.value), depth + 1);
          return [...nested, ...tokens.slice(cursor + 2)];
        }
        if (value.startsWith("--split-string=")) {
          const nested = shellWrapperTokens(shellTokens(value.slice("--split-string=".length)), depth + 1);
          return [...nested, ...tokens.slice(cursor + 1)];
        }
        const optionAdvance = envOptionAdvance(value);
        if (optionAdvance) {
          cursor += optionAdvance;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "exec") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-a") {
          cursor += 2;
          continue;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "command") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].kind === "word" && ["-p", "--"].includes(tokens[cursor].value)) cursor += 1;
      continue;
    }
    if (launcher === "builtin") {
      if (tokens[cursor + 1]?.kind !== "word" || !["command", "exec"].includes(tokens[cursor + 1].value)) break;
      cursor += 1;
      continue;
    }
    if (launcher === "timeout") {
      cursor += 1;
      const optionsWithArguments = new Set(["-k", "--kill-after", "-s", "--signal"]);
      while (cursor < tokens.length && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          if (optionsWithArguments.has(value)) cursor += 1;
          continue;
        }
        cursor += 1;
        break;
      }
      continue;
    }
    if (launcher === "nohup") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].kind === "word" && (tokens[cursor].value === "--" || tokens[cursor].value.startsWith("-"))) cursor += 1;
      continue;
    }
    if (launcher === "time") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].kind === "word" && tokens[cursor].value.startsWith("-")) {
        const value = tokens[cursor].value;
        cursor += 1;
        if (["-f", "--format", "-o", "--output"].includes(value)) cursor += 1;
      }
      continue;
    }
    if (launcher === "nice") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-n" || value === "--adjustment") {
          cursor += 2;
          continue;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "stdbuf") {
      cursor = skipStdbufOptions(tokens, cursor, tokens.length);
      continue;
    }
    if (launcher === "setsid") {
      cursor = skipSetsidOptions(tokens, cursor, tokens.length);
      continue;
    }
    if (launcher === "xargs") {
      const commandStart = skipXargsOptions(tokens, cursor, tokens.length);
      if (commandStart >= tokens.length) return tokens;
      return shellWrapperTokens(tokens.slice(commandStart), depth + 1);
    }
    break;
  }
  if (cursor > 0 && cursor < tokens.length) return shellWrapperTokens(tokens.slice(cursor), depth);
  const launcher = basename(tokens[0]?.value || "").toLowerCase();
  if (launcher === "eval") {
    const end = tokens.findIndex((token, index) => index > 0 && token.kind === "separator");
    const payload = tokens.slice(1, end === -1 ? tokens.length : end);
    if (payload.length && payload.every((token) => token.kind === "word")) {
      const nested = shellWrapperTokens(shellTokens(payload.map((token) => token.value).join(" ")), depth + 1);
      const suffix = end === -1 ? [] : tokens.slice(end);
      return suffix[0]?.kind === "separator" ? [...nested, { kind: "separator" }, ...suffix] : nested;
    }
  }
  if (!SHELL_LAUNCHERS.has(launcher)) return tokens;
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.kind !== "word") continue;
    if (tokens[index].value !== "--" && tokens[index].value !== "--command" && !/^-[^-]*c$/.test(tokens[index].value)) continue;
    const payload = tokens[index + 1];
    if (payload?.kind !== "word") return tokens;
    const nested = shellWrapperTokens(shellTokens(payload.value), depth + 1);
    const suffix = tokens.slice(index + 2);
    return suffix[0]?.kind === "separator" ? [...nested, { kind: "separator" }, ...suffix] : nested;
  }
  return tokens;
}

function commandTokens(args) {
  const command = args.command ?? args.cmd ?? args.input;
  if (typeof command === "string") return shellWrapperTokens(shellTokens(command));
  if (!Array.isArray(command)) return [];
  const values = command.filter((value) => typeof value === "string");
  let cursor = 0;
  while (cursor < values.length) {
    const launcher = basename(values[cursor]).toLowerCase();
    if (launcher === "env") {
      cursor += 1;
      while (cursor < values.length) {
        const value = values[cursor];
        if (value === "--") {
          cursor += 1;
          break;
        }
        const optionAdvance = envOptionAdvance(value);
        if (value === "-S" || value === "--split-string") {
          const payload = values[cursor + 1];
          if (typeof payload !== "string") return [];
          return [...shellWrapperTokens(shellTokens(payload)), ...values.slice(cursor + 2).map((item) => ({ kind: "word", value: item }))];
        }
        if (value.startsWith("--split-string=")) {
          return [...shellWrapperTokens(shellTokens(value.slice("--split-string=".length))), ...values.slice(cursor + 1).map((item) => ({ kind: "word", value: item }))];
        }
        if (optionAdvance) {
          cursor += optionAdvance;
          continue;
        }
        if (value.startsWith("-") || isAssignment(value)) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "stdbuf") {
      cursor = skipStdbufOptions(values, cursor, values.length);
      continue;
    }
    if (launcher === "setsid") {
      cursor = skipSetsidOptions(values, cursor, values.length);
      continue;
    }
    if (launcher === "command") {
      cursor += 1;
      continue;
    }
    break;
  }
  return shellWrapperTokens(values.slice(cursor).map((value) => ({ kind: "word", value })));
}

function codexExecDispatches(args) {
  const tokens = commandTokens(args);
  const dispatches = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word" || !/^(?:codex|codex\.exe)$/i.test(token.value.split(/[\\/]/).pop())) continue;
    const execStart = codexExecStart(tokens, index);
    if (!execStart) continue;
    if (!commandPrefixAllows(tokens, index)) continue;
    const allocation = { flagModel: execStart.flagModel, configModel: execStart.configModel, effort: execStart.effort, provider: execStart.provider };
    let cursor = execStart.index + 1;
    while (cursor < tokens.length && tokens[cursor].kind !== "separator") {
      if (tokens[cursor].kind === "redirection") {
        const afterRedirection = skipRedirection(tokens, cursor, tokens.length);
        if (afterRedirection === null) break;
        cursor = afterRedirection;
        continue;
      }
      const value = tokens[cursor].value;
      if (value === "--") break;
      const next = tokens[cursor + 1]?.value;
      if (value === "-m" || value === "--model") {
        allocation.flagModel = next;
        cursor += 1;
      } else if (value.startsWith("--model=")) {
        allocation.flagModel = value.slice("--model=".length);
      } else if (value === "-c" || value === "--config") {
        Object.assign(allocation, codexConfigValue(next));
        cursor += 1;
      } else if (value.startsWith("--config=")) {
        Object.assign(allocation, codexConfigValue(value.slice("--config=".length)));
      } else if (value === "--local-provider") {
        allocation.provider = next;
        cursor += 1;
      } else if (value.startsWith("--local-provider=")) {
        allocation.provider = value.slice("--local-provider=".length);
      }
      cursor += 1;
    }
    // Codex applies the dedicated model flag over config.model regardless
    // of argument order; exec-local flags override inherited root flags.
    const model = allocation.flagModel ?? allocation.configModel;
    dispatches.push({
      ...allocation,
      model,
      missing: [!clip(model) && "model", !clip(allocation.effort) && "reasoning_effort"].filter(Boolean),
    });
  }
  return dispatches;
}

// Installed Codex 0.154.0 emits agentsspawn_agent for agents.spawn_agent.
// V1 emits spawn_agent. Retain agents__spawn_agent only for compatibility
// with the previous gate; it is not a verified current event spelling.
// See references/native-dispatch-contract.md.
const NATIVE_TOOLS = new Set(["spawn_agent", "agentsspawn_agent", "agents__spawn_agent"]);
const SHELL_TOOLS = new Set(["Bash", "shell", "local_shell", "exec_command", "unified_exec"]);
const INHERIT_ALLOCATION = /^[ \t]*Allocation:[ \t]*inherit model and reasoning effort;[ \t]*\S[^\r\n]*\r?$/im;
const ROLE_ALLOCATION = /^[ \t]*Allocation:[ \t]*role configuration;[ \t]*\S[^\r\n]*\r?$/im;
const V2_FIELDS = new Set(["task_name", "message", "fork_turns", "model", "reasoning_effort"]);

function nativePair(model, effort) {
  if (/(?:^|\/)(?:gpt-5\.6|glm-5\.2)(?:[-\[:]|$)/i.test(String(model))) return { ok: false, reason: "model_retired" };
  try {
    // This module contains only the verified native capability snapshot.
    return require("../scripts/model-routing/native.mjs").validateNativeModelEffort(model, effort);
  } catch {
    return { ok: false, reason: "allocation_validator_unavailable" };
  }
}

function allocationError(result, model) {
  if (result.reason === "model_retired") return `model '${clip(model)}' is retired. Choose a current model and supported reasoning effort.`;
  if (result.reason === "effort_unsupported") {
    return `reasoning_effort for '${clip(model)}' must be one of: ${result.supportedEfforts.join(", ")}. Keep the requested model and choose a supported effort; no fallback was applied.`;
  }
  if (result.reason === "native_model_unsupported") {
    return `'${clip(model) || "(missing)"}' is not in this native tool's verified model roster. Use a model exposed by this tool or an explicitly configured external CLI route; no fallback was applied.`;
  }
  return "the native allocation validator could not be loaded. Repair the plugin before dispatching; no fallback was applied.";
}

function validateNative(args, input, tool) {
  // V2 requires task_name; V1 accepts agent_type/items/fork_context. A V2
  // payload must never be interpreted as a configurable V1 specialist role.
  const v2 = tool !== "spawn_agent" || Object.hasOwn(args, "task_name") || Object.hasOwn(args, "fork_turns");
  const hasModel = Object.hasOwn(args, "model");
  const hasEffort = Object.hasOwn(args, "reasoning_effort");
  const message = typeof args.message === "string" ? args.message : "";
  const inherit = INHERIT_ALLOCATION.test(message);
  const useRole = ROLE_ALLOCATION.test(message);
  const role = typeof args.agent_type === "string" ? args.agent_type.trim() : "";

  if (v2 && Object.keys(args).some((key) => !V2_FIELDS.has(key))) {
    return { error: "this native tool has no extra parameters. Use only its task_name/message/fork_turns/model/reasoning_effort fields; agent_type and provider controls require another supported surface." };
  }
  if (v2 && (typeof args.task_name !== "string" || !args.task_name.trim())) {
    return { error: "this native tool requires a nonempty task_name and message." };
  }
  if (!message.trim() && !(!v2 && Array.isArray(args.items) && args.items.length)) {
    return { error: "supply a nonempty task brief in message, including the bounded work and expected result." };
  }
  if (v2 && args.fork_turns !== undefined && args.fork_turns !== "all" && args.fork_turns !== "none" && !(typeof args.fork_turns === "string" && /^[1-9]\d*$/.test(args.fork_turns))) {
    return { error: 'fork_turns must be "all", "none", or a positive integer string. Use none or limited history with a sufficient task brief when changing model or effort.' };
  }
  if (!v2 && Object.hasOwn(args, "fork_context") && typeof args.fork_context !== "boolean") {
    return { error: "the CLI V1 fork_context parameter must be a boolean." };
  }
  const fullHistory = v2 ? args.fork_turns === undefined || args.fork_turns === "all" : args.fork_context === true;
  if (fullHistory && (hasModel || hasEffort)) {
    return { error: v2
      ? 'a full-history fork (fork_turns:"all" or omitted) cannot override model or reasoning_effort. Omit both overrides and state "Allocation: inherit model and reasoning effort; <reason>." in message, or use fork_turns:"none" or a positive limited-history value with a sufficient task brief for the selected pair.'
      : "a full-history CLI fork cannot override model or reasoning_effort. Omit both overrides and state 'Allocation: inherit model and reasoning effort; <reason>.' in message, or use fork_context:false with a sufficient task brief." };
  }
  if (!v2 && role) {
    if (hasModel || hasEffort) {
      return { error: "a named CLI role owns its configured model and effort. Omit both overrides, inspect the role configuration, and state 'Allocation: role configuration; <reason>.' in message. Any controls the role leaves unset deliberately inherit. For an explicit pair without role configuration, omit agent_type." };
    }
    if (fullHistory) return { error: "a full-history CLI fork cannot select a configured agent_type. Use fork_context:false with a sufficient task brief." };
    if (!useRole) return { error: "state 'Allocation: role configuration; <reason>.' in message to deliberately use the named role's fixed controls and inherit any unset controls." };
    return { allocation: "role", role, capability: "runtime_unverified" };
  }
  if (useRole) return { error: "role configuration allocation requires a named CLI agent_type; it is not a model override or a native V2 parameter." };
  if (inherit) {
    if (hasModel || hasEffort) return { error: "inheritance conflicts with explicit model or reasoning_effort. Omit both overrides or remove the inheritance declaration and choose both controls." };
    return { allocation: "inherit", model: clip(input.model), role: role || undefined, capability: "runtime_inherited" };
  }
  const missing = [!clip(args.model) && "model", !clip(args.reasoning_effort) && "reasoning_effort"].filter(Boolean);
  if (missing.length) {
    if (fullHistory) return { error: "a full-history fork must deliberately inherit: state 'Allocation: inherit model and reasoning effort; <reason>.' in message and omit model and reasoning_effort. To choose an explicit pair, first select none/limited history (CLI V1: fork_context:false) and provide a sufficient task brief." };
    return { error: `choose ${missing.join(" and ")} explicitly, or state 'Allocation: inherit model and reasoning effort; <reason>.' in message and omit both overrides. A custom CLI role may instead use its authoritative role configuration.` };
  }
  const result = nativePair(args.model, args.reasoning_effort);
  if (!result.ok) return { error: allocationError(result, args.model) };
  return { allocation: "explicit", model: args.model, effort: args.reasoning_effort, role: role || undefined, capability: "known_pair" };
}

function validateClaude(args) {
  // Claude Agent exposes model but no per-call effort field. Do not invent
  // one or claim to validate an effort the hook cannot observe.
  if (Object.hasOwn(args, "reasoning_effort") || Object.hasOwn(args, "effort")) return { error: "Claude Agent does not expose a per-call effort parameter. Deliberately use the session's inherited effort or a configured subagent definition with model and effort; an explicit CLI route uses --effort." };
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const inherit = INHERIT_ALLOCATION.test(prompt);
  const useRole = ROLE_ALLOCATION.test(prompt);
  if (args.subagent_type === "fork") {
    if (Object.hasOwn(args, "model")) return { error: "Claude fork subagents ignore model overrides and inherit the parent. Omit model and declare 'Allocation: inherit model and reasoning effort; <reason>.' in prompt, or choose a non-fork subagent with sufficient context." };
    if (!inherit) return { error: "Claude fork subagents inherit the parent: declare 'Allocation: inherit model and reasoning effort; <reason>.' in prompt." };
    return { allocation: "inherit", capability: "runtime_inherited" };
  }
  // Claude 2.1.270 parses this env flag with P.bool -> Ie, not JS truthiness.
  const forceModel = ["1", "true", "yes", "on"].includes((process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? "").toLowerCase().trim());
  if (forceModel && Object.hasOwn(args, "model")) return { error: "This Claude runtime forces subagent model selection and does not expose a model override. Use deliberate inheritance or the authoritative role configuration; do not silently substitute a requested model." };
  if (useRole) {
    if (!clip(args.subagent_type) || Object.hasOwn(args, "model")) return { error: "role configuration allocation requires subagent_type and no model override; the runtime resolves the role's controls." };
    return { allocation: "role", capability: "runtime_unverified" };
  }
  if (inherit) {
    if (Object.hasOwn(args, "model")) return { error: "inheritance conflicts with the explicit Claude model. Omit the model override when declaring inheritance in prompt." };
    // A named definition or configured subagent default may take precedence
    // over the parent. The declaration expresses intent, not a resolved pair.
    return { allocation: "inherit", capability: "runtime_unverified" };
  }
  if (!clip(args.model)) return { error: "select a Claude model explicitly, declare 'Allocation: inherit model and reasoning effort; <reason>.' in prompt, or declare 'Allocation: role configuration; <reason>.' for a configured subagent_type." };
  let aliases;
  try {
    ({ CLAUDE_AGENT_MODEL_ALIASES: aliases } = require("../scripts/model-routing/claude.mjs"));
  } catch {
    return { error: "the Claude allocation validator could not be loaded. Repair the plugin before dispatching; no fallback was applied." };
  }
  if (!aliases.includes(args.model)) {
    return { error: `'${clip(args.model)}' is not exposed by Claude Agent's model control (opus, sonnet, haiku, fable). For exact Fable 5.1, use model claude-fable-5-1 in a configured subagent definition or its supported CLI or adapter; native Codex models require their own harness.` };
  }
  return { allocation: "explicit", model: args.model, capability: "runtime_effort_unobserved" };
}

function handlePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const args = input.tool_input && typeof input.tool_input === "object" && !Array.isArray(input.tool_input) ? input.tool_input : {};
  const block = (message) => {
    process.stderr.write("[railyard] Dispatch refused: " + message + "\n");
    process.exitCode = 2;
  };
  const log = (entry) => record({
    event: "dispatch",
    phase: "pre_tool_use",
    tool,
    session_id: clip(input.session_id),
    ...entry,
  });
  if (NATIVE_TOOLS.has(tool)) {
    const result = validateNative(args, input, tool);
    if (result.error) return block(result.error);
    log({ harness: "codex", ...result, reasoning_effort: result.effort, label: clip(args.task_name), fork_turns: clip(args.fork_turns) });
    return;
  }
  if (tool === "Agent" || tool === "Task") {
    const result = validateClaude(args);
    if (result.error) return block(result.error);
    log({ harness: "claude-code", ...result, role: clip(args.subagent_type, 60), label: clip(args.description) });
    return;
  }
  if (!SHELL_TOOLS.has(tool)) return;
  const dispatches = codexExecDispatches(args);
  // Validate the entire shell invocation before recording any allowed
  // request: a refusal prevents every command in that invocation from running.
  for (const dispatch of dispatches) {
    if (dispatch.missing.length) return block(`codex exec must set explicit ${dispatch.missing.join(" and ")} using --model and -c model_reasoning_effort=<effort>.`);
    const result = nativePair(dispatch.model, dispatch.effort);
    if (!result.ok && result.reason !== "native_model_unsupported") return block(allocationError(result, dispatch.model));
    if (!result.ok && !clip(dispatch.provider)) return block(`codex exec model '${clip(dispatch.model)}' is outside the verified native roster. An explicit external route must also set -c model_provider=<provider> (or --local-provider). Its runtime must validate the requested pair; no fallback was applied.`);
    dispatch.capability = result.ok ? "known_pair" : "runtime_unverified";
  }
  for (const dispatch of dispatches) {
    log({ harness: "codex", allocation: "explicit", model: clip(dispatch.model), effort: clip(dispatch.effort, 20), reasoning_effort: clip(dispatch.effort, 20), provider: clip(dispatch.provider), capability: dispatch.capability });
  }
}

let raw = "";
let inputHandled = false;
let inputTimer;
function handleInput({ final = false } = {}) {
  if (inputHandled) return;
  if (inputTimer) clearTimeout(inputTimer);
  let input;
  try { input = JSON.parse(raw); } catch {
    if (final) inputHandled = true;
    return;
  }
  inputHandled = true;
  handlePayload(input);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    handleInput();
    if (inputHandled) process.exit(process.exitCode || 0);
  }, 50);
});
process.stdin.on("end", () => handleInput({ final: true }));
// Some runners leave stdin open. A complete payload exits promptly; a gap
// inside incomplete JSON never finalizes the allocation check.
