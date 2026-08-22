#!/usr/bin/env node
// PreToolUse: enforce the explicit-model dispatch rule as mechanism, not
// prose. A subagent dispatch that omits its model (and, on Codex, effort)
// silently inherits the session's premium tier — this gate refuses the call
// with a corrective message so the model retries with the fields set.
// Cross-platform, dependency-free. Fails OPEN for anything it does not
// recognize: the gate must never break a session.
//
// It also records every ALLOWED dispatch to the run log — the mechanical
// half of railyard:audit. Recording is best-effort and never affects the
// verdict: a missing or broken recorder leaves the gate exactly as it was.
let record = () => {};
let hasEntry = () => false;
let rs = null;
let clip = (value, max = 120) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};
try {
  ({ record, clip, hasEntry } = require("./run-log.js"));
  try { rs = require("./route-state.js"); } catch {}
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

function codexExecStart(tokens, index) {
  let cursor = index + 1;
  let model;
  let effort;
  while (cursor < tokens.length && tokens[cursor].kind === "word") {
    const value = tokens[cursor].value;
    const next = tokens[cursor + 1]?.value;
    if (value === "exec") return { index: cursor, model, effort };
    if (value === "--") return null;
    if (value === "-m" || value === "--model") {
      model = next;
      cursor += 2;
      continue;
    }
    if (value.startsWith("--model=")) {
      model = value.slice("--model=".length);
      cursor += 1;
      continue;
    }
    if (value === "-c" || value === "--config") {
      const match = (next || "").match(/^model_reasoning_effort\s*=\s*(.+)$/);
      if (match) effort = match[1].replace(/^(['"])(.*)\1$/, "$2");
      cursor += 2;
      continue;
    }
    if (value.startsWith("--config=")) {
      const match = value.slice("--config=".length).match(/^model_reasoning_effort\s*=\s*(.+)$/);
      if (match) effort = match[1].replace(/^(['"])(.*)\1$/, "$2");
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
    let model = execStart.model;
    let effort = execStart.effort;
    let label;
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
        model = next;
        cursor += 1;
      } else if (value.startsWith("--model=")) {
        model = value.slice("--model=".length);
      } else if (value === "-c" || value === "--config") {
        const match = (next || "").match(/^model_reasoning_effort\s*=\s*(.+)$/);
        if (match) effort = match[1].replace(/^(['"])(.*)\1$/, "$2");
        cursor += 1;
      } else if (value.startsWith("--reasoning-effort=") || value.startsWith("--reasoning_effort=")) {
        effort = value.slice(value.indexOf("=") + 1);
      } else if (value === "--reasoning-effort" || value === "--reasoning_effort") {
        effort = next;
        cursor += 1;
      } else if (value === "--label" || value === "--task-name") {
        label = next;
        cursor += 1;
      } else if (value.startsWith("--label=") || value.startsWith("--task-name=")) {
        label = value.slice(value.indexOf("=") + 1);
      }
      cursor += 1;
    }
    const clippedModel = clip(model);
    const clippedEffort = clip(effort, 20);
    dispatches.push({
      model: clippedModel,
      effort: clippedEffort,
      label: clip(label),
      missing: [!clippedModel && "model", !clippedEffort && "reasoning_effort"].filter(Boolean),
    });
  }
  return dispatches;
}

let raw = "";
process.stdin.setEncoding("utf8");
let inputHandled = false;
let inputTimer;
function armInputTimer() {
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    handleInput();
    if (inputHandled) process.exit(process.exitCode || 0);
  }, 50);
}
process.stdin.on("data", (c) => {
  raw += c;
  armInputTimer();
});
// Build the carrier kernel text injected into the spawn prompt.
function buildCarrierKernel(routeId) {
  var cli = require("path").join(__dirname, "..", "scripts", "route-carrier.mjs");
  return "[railyard] Route-carrier protocol active. Route ID: " + routeId + "."
    + " You are the LFG delivery carrier. Execute compound-engineering:lfg through its full pipeline."
    + " Record stage receipts: node " + cli + " receipt " + routeId + " <event>"
    + " For terminal states use TRANSITION: node " + cli + " transition " + routeId + " lfg_complete"
    + " Or block: node " + cli + " block <reason>"
    + " Do NOT return early at checkpoints. SubagentStop will force continuation.";
}

function handleInput({ final = false } = {}) {
  if (inputHandled) return;
  if (inputTimer) clearTimeout(inputTimer);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    if (final) inputHandled = true;
    return; // malformed input: allow
  }
  inputHandled = true;
  const tool = String(input.tool_name || "");
  const args = input.tool_input && typeof input.tool_input === "object"
    ? input.tool_input
    : {};

  const block = (msg) => {
    process.stderr.write(msg + "\n");
    process.exitCode = 2;
  };

  if (tool === "Agent" || tool === "Task") {
    // Claude Code subagent dispatch: the model field is required. Any
    // explicit value — including the session's own tier — passes; writing
    // it is what makes an escalation named.
    if (typeof args.model !== "string" || !args.model.trim()) {
      block(
        "[railyard] Dispatch refused: every subagent names an explicit model" +
          " (no silent inheritance of the session tier). Set model:" +
          " opus for implementation/research/review, sonnet or haiku for" +
          " mechanical work; setting the session's own tier explicitly is a" +
          " named escalation. Retry the same call with the model field set.",
      );
      return;
    }
    // Cross-harness guardrail (interim): a Claude Code session dispatching a
    // subagent onto an OpenAI/Codex-family model routes work into a harness
    // that meters separately — it must be an explicit opt-in, never the
    // silent product of a harness-independent default. Refuse unless the
    // dispatch says "cross-harness" somewhere in its prompt or description.
    // The durable fix is the harness-aware router default (queued), which
    // stops the silent selection at the source; until it ships, this gate is
    // the guardrail. ponytail: substring opt-in marker, precision over
    // recall — a real cross-harness dispatch just names itself.
    const crossHarnessFamily = (m) => /^(gpt-|o[0-9]|codex)/i.test(m);
    if (crossHarnessFamily(args.model.trim())) {
      const marker = [args.prompt, args.description]
        .filter((v) => typeof v === "string")
        .join("\n");
      if (!/cross-harness/i.test(marker)) {
        block(
          "[railyard] Dispatch refused: '" + args.model.trim() + "' is an" +
            " OpenAI/Codex-family model, and this is a Claude Code session —" +
            " cross-harness dispatch meters separately and is explicit opt-in" +
            " only, never a silent default. If you truly mean to run this" +
            " worker on the other harness, say so in the dispatch (include" +
            " 'cross-harness' and the reason) and retry; otherwise route it to" +
            " a Claude model (opus/sonnet/haiku).",
        );
        return;
      }
    }
    // Route-carrier receipt for Claude Code subagent dispatches
    const ccDispatchText = [args.prompt, args.description, args.subagent_type]
      .filter((v) => typeof v === "string").join(" ");
    if (/\b(?:lfg|compound-engineering:lfg|railyard:deliver|ce-babysit-pr|ce-resolve-pr-feedback)\b/i.test(ccDispatchText)) {
      var ccSid = input.session_id || process.env.CLAUDE_CODE_SESSION_ID || null;
      if (rs && rs.getActiveRoute(ccSid)) {
        block("[railyard] An active LFG carrier already exists for this lane.");
        return;
      }
      var ccRoute = rs ? rs.createRoute({ session_id: ccSid, label: clip(args.description) }) : null;
      record({ event: "route_carrier", tool, model: args.model ? args.model.trim() : "",
        label: clip(args.description || ""), session_id: clip(input.session_id),
        route_id: ccRoute ? ccRoute.route_id : undefined });
      // Feedback resolution receipt: ce-resolve-pr-feedback was dispatched
      if (rs && /ce-resolve-pr-feedback/i.test(ccDispatchText)) {
        var fbRoute = ccRoute;
        if (fbRoute) rs.recordReceipt(fbRoute.route_id, { event: "feedback_resolution_started" });
      }
      // Feedback resolution receipt: ce-resolve-pr-feedback was dispatched
      if (rs && /ce-resolve-pr-feedback/i.test(ccDispatchText)) {
        var fbRoute = ccRoute;
        if (fbRoute) rs.recordReceipt(fbRoute.route_id, { event: "feedback_resolution_started" });
      }
      if (ccRoute && typeof args.prompt === "string") {
        process.stdout.write(JSON.stringify({ updatedInput: {
          model: args.model, description: args.description, subagent_type: args.subagent_type,
          prompt: args.prompt + String.fromCharCode(10) + String.fromCharCode(10) + buildCarrierKernel(ccRoute.route_id),
        }}) + "\\n");
        return;
      }
    }
    record({
      event: "dispatch",
      harness: "claude-code",
      tool,
      model: args.model.trim(),
      role: clip(args.subagent_type, 60),
      label: clip(args.description),
      session_id: clip(input.session_id),
    });
    return;
  }

  // Codex Desktop's multi-agent v2 surface exposes the spawn tool as
  // agents__spawn_agent; the CLI uses the bare name. Accept both spellings so
  // the explicit-model rule cannot be bypassed by a harness alias.
  if (tool === "spawn_agent" || tool === "agents__spawn_agent") {
    // Codex subagent dispatch: model + reasoning_effort both required.
    const missing = [];
    if (typeof args.model !== "string" || !args.model.trim()) missing.push("model");
    if (args.reasoning_effort == null || args.reasoning_effort === "") {
      missing.push("reasoning_effort");
    }
    if (missing.length) {
      block(
        "[railyard] Dispatch refused: spawn_agent must set " +
          missing.join(" and ") +
          " explicitly (no silent inheritance of the session tier)." +
          " Retry with the fields set.",
      );
      return;
    }
    // Provider coherence: spawn_agent has no provider field — a child
    // inherits the thread's provider. A non-OpenAI child model therefore
    // only works when non-OpenAI routing is configured at all. Provider ids
    // are arbitrary and unrelated to model families (zai_litellm serves
    // glm-*), so we can only check that some [model_providers.*] section
    // exists — never claim a *named* provider is missing. The payload
    // carries no session model field, so family coherence is unknowable
    // here and is not asserted.
    // ponytail: line-anchored section grep, not a TOML parse — upgrade to a
    // real parser only if provider sections start appearing in odd shapes.
    const child = args.model.trim();
    let refused = false;
    const openaiLike = (m) => /^(gpt-|o[0-9]|codex)/i.test(m);
    if (!openaiLike(child)) {
      let providersConfigured = true; // fail open when unreadable
      try {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
        const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
        providersConfigured = /^[ \t]*\[model_providers[.\]]/m.test(toml);
      } catch {}
      if (!providersConfigured) {
        refused = true;
        block(
          "[railyard] Dispatch refused: '" + child + "' is not an OpenAI-served" +
            " model, and spawn_agent cannot switch providers — the child" +
            " inherits this thread's provider. The active config.toml declares" +
            " no [model_providers.*] section, so no non-OpenAI provider is" +
            " configured at all. Start a dedicated thread instead (thread/start" +
            " with model + modelProvider, or `codex exec -m " + child +
            " -c model_provider=<provider>`).",
        );
      }
    }
    // Route-carrier receipt: when a subagent dispatch names a delivery
    // pipeline skill (LFG, babysit-pr, etc.), record it so the route gate
    // can verify that delivery was actually dispatched before push/PR.
    const dispatchText = [args.task_name, args.message, args.prompt]
      .filter((v) => typeof v === "string").join(" ");
    if (/\b(?:lfg|compound-engineering:lfg|railyard:deliver|ce-babysit-pr|ce-resolve-pr-feedback)\b/i.test(dispatchText)) {
      var codexSid = input.session_id || process.env.CODEX_THREAD_ID || null;
      if (rs && rs.getActiveRoute(codexSid)) {
        block("[railyard] An active LFG carrier already exists for this lane.");
        return;
      }
      var codexRoute = rs ? rs.createRoute({ session_id: codexSid, label: clip(args.task_name) }) : null;
      record({ event: "route_carrier", tool, model: args.model ? args.model.trim() : "",
        label: clip(args.task_name || args.description || ""), session_id: clip(input.session_id),
        route_id: codexRoute ? codexRoute.route_id : undefined });
      // Feedback resolution receipt: ce-resolve-pr-feedback was dispatched
      if (rs && /ce-resolve-pr-feedback/i.test(dispatchText)) {
        var fbRoute = codexRoute;
        if (fbRoute) rs.recordReceipt(fbRoute.route_id, { event: "feedback_resolution_started" });
      }
      // Feedback resolution receipt: ce-resolve-pr-feedback was dispatched
      if (rs && /ce-resolve-pr-feedback/i.test(dispatchText)) {
        var fbRoute = codexRoute;
        if (fbRoute) rs.recordReceipt(fbRoute.route_id, { event: "feedback_resolution_started" });
      }
      if (codexRoute && typeof args.message === "string") {
        process.stdout.write(JSON.stringify({ updatedInput: {
          model: args.model, reasoning_effort: args.reasoning_effort, task_name: args.task_name,
          message: args.message + String.fromCharCode(10) + String.fromCharCode(10) + buildCarrierKernel(codexRoute.route_id),
        }}) + "\\n");
        return;
      }
    }
    if (!refused) {
      record({
        event: "dispatch",
        harness: "codex",
        tool,
        model: child,
        effort: clip(String(args.reasoning_effort), 20),
        label: clip(args.task_name),
        session_id: clip(input.session_id),
      });
    }
    return;
  }

  if (["Bash", "shell", "local_shell", "exec_command", "unified_exec"].includes(tool)) {

    // Route-carrier gate: before any mutation surface (git push, gh pr create),
    // verify that a delivery pipeline was dispatched via a run-log entry. This
    // catches the repeated failure where agents implement directly and skip
    // LFG/babysit-pr entirely. The run-log entry is written by spawn_agent
    // dispatches whose task_name or message mentions lfg, deliver, or babysit.
    const text = typeof args.command === "string" ? args.command
      : typeof args.cmd === "string" ? args.cmd
      : Array.isArray(args.input) ? args.input.join(" ")
      : "";
    // TOCTOU guard: refuse a single shell call that both mutates HEAD and creates a PR.
    if (/\b(git\s+(commit|merge|rebase|cherry-pick|revert|reset|checkout|switch|pull)\b).*\b(gh\s+pr\s+create\b)|\b(gh\s+pr\s+create\b).*\b(git\s+(commit|merge|rebase|cherry-pick|revert|reset|checkout|switch|pull)\b)/.test(text)) {
      block(
        "[railyard] TOCTOU guard: this shell call both changes HEAD and creates a PR. Split them."
      );
      return;
    }
    // Feedback resolution gate: gh pr comment/reply requires feedback_resolution_started
    if (/gh pr comment|pulls.*comments.*replies/.test(text)) {
      if (rs) {
        var fsid = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
        var fRoute = rs.getActiveRoute(fsid);
        if (fRoute) {
          var hasFeedback = false;
          for (var fi = 0; fi < (fRoute.receipts || []).length; fi++) {
            if (fRoute.receipts[fi].event === "feedback_resolution_started") { hasFeedback = true; break; }
          }
          if (!hasFeedback) {
            block(
              "[railyard] Feedback resolution gate: dispatch ce-resolve-pr-feedback before replying to PR feedback."
            );
            return;
          }
        }
      }
    }

    // Feedback resolution gate: gh pr comment/reply requires feedback_resolution_started
    if (/gh pr comment|pulls.*comments.*replies/.test(text)) {
      if (rs) {
        var fsid = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
        var fRoute = rs.getActiveRoute(fsid);
        if (fRoute) {
          var hasFeedback = false;
          for (var fi = 0; fi < (fRoute.receipts || []).length; fi++) {
            if (fRoute.receipts[fi].event === "feedback_resolution_started") { hasFeedback = true; break; }
          }
          if (!hasFeedback) {
            block(
              "[railyard] Feedback resolution gate: dispatch ce-resolve-pr-feedback before replying to PR feedback."
            );
            return;
          }
        }
      }
    }


    // Merge gate: gh pr merge requires lfg_complete.
    if (/\bgh\s+pr\s+merge\b/.test(text)) {
      if (rs) {
        var msid = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
        var mcomplete = false;
        try {
          var mdir = rs.stateDir();
          var mfs = require('fs');
          var mfiles = mfs.readdirSync(mdir).filter(function(f) { return f.endsWith('.json') && !f.startsWith('candidate-'); });
          for (var mi = 0; mi < mfiles.length; mi++) {
            var mr = rs.readRoute(mfiles[mi].replace('.json', ''));
            if (mr && mr.state === 'lfg_complete' && (!msid || mr.parent_session_id === msid)) { mcomplete = true; break; }
          }
        } catch {}
        if (!mcomplete) {
          block(
            "[railyard] Merge refused: the delivery route has not reached lfg_complete."
          );
          return;
        }
      }
    }
    if (/\bgit\s+push\b|\bgh\s+pr\s+create\b/.test(text)) {
      if (rs) {
        var sessionId = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
        var activeRoute = rs.getActiveRoute(sessionId);
        var hasCandidate = rs.hasDeliveryCandidate(sessionId);
        if (activeRoute && activeRoute.state === 'pending_spawn') {
          block(
            "[railyard] Push refused: delivery route is pending_spawn. The carrier subagent must actually start before any push."
          );
          return;
        }
        if (!activeRoute && hasCandidate) {
          block(
            "[railyard] Push refused: session classified as delivery work but no carrier dispatched. Dispatch a carrier naming lfg/deliver/babysit."
          );
          return;
        }
      } else if (!hasEntry("route_carrier")) {
        // Fallback: run-log only when route-state is unavailable
        block(
          "[railyard] Route carrier missing: no delivery pipeline was dispatched. If you are running railyard:deliver, invoke compound-engineering:lfg as a subagent first."
        );
        return;
      }
    }
    // PR-create gate: requires carrier_started + HEAD-bound pr_create_ready receipt.
    if (new RegExp("\\bgh\\s+pr\\s+create\\b").test(text)) {
      if (rs) {
        var psid = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
        var prRoute = rs.getActiveRoute(psid);
        if (!prRoute) {
          block(
            "[railyard] Route carrier required: no active delivery route. Dispatch a carrier naming lfg/deliver/babysit before creating a PR."
          );
          return;
        }
        if (prRoute.state === "pending_spawn") {
          block(
            "[railyard] Route carrier not started: pending_spawn. Wait for SubagentStart before PR creation."
          );
          return;
        }
        var prReceipt = null;
        for (var ri = (prRoute.receipts || []).length - 1; ri >= 0; ri--) {
          if (prRoute.receipts[ri].event === "pr_create_ready") { prReceipt = prRoute.receipts[ri]; break; }
        }
        if (!prReceipt) {
          block(
            "[railyard] PR-create receipt missing: carrier must record pr_create_ready --head-sha <sha> --branch <branch>."
          );
          return;
        }
      }
    }
    try {
      for (const dispatch of codexExecDispatches(args)) {
        if (dispatch.missing.length) {
          block(
            "[railyard] Dispatch refused: codex exec must set explicit " +
              dispatch.missing.join(" and ") +
              " (no silent inheritance of the session tier). Retry with " +
              "--model and model_reasoning_effort set.",
          );
          return;
        }
        record({
          event: "dispatch",
          harness: "codex",
          tool,
          model: dispatch.model,
          effort: dispatch.effort,
          reasoning_effort: dispatch.effort,
          label: dispatch.label,
          session_id: clip(input.session_id),
        });
      }
    } catch {}
    return;
  }
  // Any other tool: allow.
}
process.stdin.on("end", () => handleInput({ final: true }));
// Some hook runners keep stdin open after delivering the payload. Never let
// that turn a fail-open hook into a shell deadlock; a complete payload is
// parsed and exits within the dispatch budget. Incomplete JSON stays open
// until the next chunk or stdin end, so a gap cannot bypass the gate.
