#!/usr/bin/env bash
# Counts forbidden and watched patterns; module paths use the source parser.
# Usage: bash style-census.sh [FILE|DIR ...] [--strict]
# Source checks (S*) run on .ts/.tsx/.mts that are not tests.
# Test checks (T*) run on .test/.spec files with .ts/.tsx/.mts endings.
# Watch checks (W*) are reported, never enforced; the formatter or a reviewer decides.
# Performance checks (P*) run on source and are enforced like S*.
# --strict exits 1 when any S*, T*, or P* id has a hit.
# Ids in doc_blind skip text inside /** ... */, so prose like `a/*b` or `x[0]` is not a hit.
set -euo pipefail

strict=0
targets=()
while (( $# )); do
  case "$1" in
    --strict) strict=1; shift ;;
    *) targets+=("$1"); shift ;;
  esac
done
(( ${#targets[@]} )) || targets=(.)

test_glob='.*\.(test|spec)\.(ts|tsx|mts)$'
all_files=$(find "${targets[@]}" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.stryker-tmp/*' \
  -not -name '*.d.ts' 2>/dev/null || true)
src_files=$(printf '%s\n' "$all_files" | grep -Ev "$test_glob" || true)
test_files=$(printf '%s\n' "$all_files" | grep -E "$test_glob" || true)

# id|scope|label|regex   scope: src | test | all
patterns='
S01|src|#private field or method|(this\.#[a-zA-Z]|^[[:space:]]*(static |readonly |async |override )*#[a-zA-Z]+[ (:<=])
S02|src|cast through unknown|as unknown as
S03|src|Any-prefixed type name|\bAny[A-Z][A-Za-z]+
S04|src|swallowed promise|\.catch\(\(\) => (undefined|\{\})\)|^[[:space:]]*void [a-zA-Z_.]+\(
S05|src|bare throw new Error / TypeError|throw new (Error|TypeError|RangeError)\(
S06|src|console in source|\bconsole\.[a-z]+\(
S07|src|enum declaration|^[[:space:]]*(export )?(const )?enum 
S08|src|Reflect call|\bReflect\.[a-zA-Z]+\(
S09|src|layer word in a name|^(?!\s*import\b).*\b[A-Za-z]*(Runtime|Manager|Handler|Wrapper|Candidate|Provenance)\b
S10|src|line comment (only TSDoc allowed)|^[[:space:]]*//|[[:space:];][/]{2}[^/]
S11|src|block comment that is not TSDoc|/\*[^*]
S12|all|ts-ignore / ts-expect-error|@ts-(ignore|expect-error)
S13|all|lint disable|(eslint|oxlint|biome)-disable
S14|src|tuple index read x[N]|[a-zA-Z_]+\[[0-9]\][^=]
S15|src|Object.freeze of a value (empty-literal sentinel allowed)|Object\.freeze\((?!\[\]\)|\{\}\))
S17|all|TypeScript import ending (omit .ts/.tsx/.mts)|(parser)
S16|src|preset() call in source (test-only API)|^(?![[:space:]]*[*/])(?:(?!//|/\*|["\x27\x60]).)*(?<!function )\bpreset\b[[:space:]]*(<[^;>]*>)?[[:space:]]*\(
T01|test|mock or spy|\bvi\.(mock|fn|spyOn|doMock|stubGlobal|useFakeTimers)\(
T02|test|sleeping in a test|\bsetTimeout\(|(?<!\.)\bsleep\(
T03|test|only / skip left in|\.(only|skip)\(
T04|test|import of a private source module|from "\.\./src/(?!index")|from "\.\./src/[^"]*/[^"]+"
T05|test|internals asserted|Object\.(isFrozen|getPrototypeOf|getOwnPropertyDescriptor)\(
T06|test|cast through unknown|as unknown as
T08|test|isError inside expect (guard used as assertion)|expect\(isError\(
T09|test|mutation-score or coverage named in a test title|(test|it)\("[^"]*(mutant|mutation|coverage)
T07|test|instanceof or message assert around an error|\.(toBeInstanceOf|toThrowErrorMatchingInlineSnapshot)\(|toThrow\("[^"]+"\)
P01|src|accessor in an object literal (class + prototype accessor)|^[[:space:]]{4,}(get|set) [A-Za-z_]+\(
P02|src|constructor parameter property (strip-types rejects)|constructor\((private|protected|public|readonly) |^[[:space:]]+(private|protected|public|readonly) [A-Za-z_]+\??: [^;]*[,)][[:space:]]*$
P04|src|Set/Map seeded from an array literal (use add/set)|new (Set|Map)\(\[
W10|src|Proxy creation (share one trap object)|new Proxy\(
W12|src|Object.defineProperty (never on a hot path)|Object\.define(Property|Properties)\(
W11|src|bind(this) (arrow field instead)|\.bind\(this\)
W01|src|readonly modifier|\breadonly\b
W02|src|as const|\bas const\b
W03|src|satisfies|\bsatisfies\b
W04|src|non-null assertion x!|[A-Za-z0-9_)\]]!([.\[)\],;]|$)
W05|src|explicit any|:[[:space:]]*any\b
W06|src|let x!: definite assignment|\blet [a-zA-Z]+!:
W07|all|line longer than 100 chars|^.{101,}
W09|src|interface declaration (type preferred)|^[[:space:]]*(export )?interface 
W08|test|test count (watch: many small tests)|^[[:space:]]*(test|it)\(
'

doc_blind=' S11 S14 '

# Prints file:line:text for each line whose text, with /** ... */ blanked, matches $1.
# Quotes and // comments are skipped whole, so a "/**" in a string never opens a doc.
# A template string can span lines; its state carries over like a doc's.
# Known limits: a regex literal like /[/**]/ or JSX text like <p>/** open</p> opens a doc.
doc_blind_grep='
my $re = shift;
for my $file (@ARGV) {
  open my $fh, "<", $file or next;
  my ($doc, $tpl) = (0, 0);
  while (my $line = <$fh>) {
    chomp $line;
    my ($code, $rest) = ("", $line);
    while ($rest ne "") {
      if ($doc) {
        if ($rest =~ s{^.*?\*/}{}) { $doc = 0; $code .= " "; } else { $rest = ""; }
      } elsif ($tpl) {
        if ($rest =~ s{^((?:\\.|[^\\`])*`)}{}) { $code .= $1; $tpl = 0; }
        else { $code .= $rest; $rest = ""; }
      } elsif ($rest =~ s{^(`(?:\\.|[^\\`])*)(`?)}{}) {
        $code .= $1 . $2; $tpl = $2 eq "" ? 1 : 0;
      } elsif ($rest =~ s{^(\x27(?:\\.|[^\\\x27])*\x27?|"(?:\\.|[^\\"])*"?|//.*)}{}) {
        $code .= $1;
      } elsif ($rest =~ s{^/\*\*(?!/)}{}) {
        $doc = 1; $code .= " ";
      } else {
        $rest =~ s{^(.[^\x27"`/]*)}{}s; $code .= $1;
      }
    }
    print "$file:$.:$line\n" if $code =~ $re;
  }
  close $fh;
}
'

hits() {
  local id=$1 regex=$2 files=$3
  if [[ "$id" == S17 ]]; then
    printf '%s\n' "$files" | xargs -r node "$(dirname "${BASH_SOURCE[0]}")/import-extensions.mjs"
  elif [[ "$doc_blind" == *" $id "* ]]; then
    printf '%s\n' "$files" | xargs -r perl -e "$doc_blind_grep" -- "$regex" 2>/dev/null || true
  else
    printf '%s\n' "$files" | xargs -r grep -nHP -- "$regex" 2>/dev/null || true
  fi
}

failed=""
printf '%-4s %6s  %s\n' id count label
while IFS='|' read -r id scope label regex; do
  [[ -n "$id" && -n "$regex" ]] || continue
  case "$scope" in
    src) files=$src_files ;;
    test) files=$test_files ;;
    *) files=$all_files ;;
  esac
  if [[ -z "$files" ]]; then
    count=0
  else
    count=$(hits "$id" "$regex" "$files" | awk 'END { print NR + 0 }')
  fi
  printf '%-4s %6s  %s\n' "$id" "$count" "$label"
  if (( strict )) && [[ "$id" == [STP]* ]] && (( count > 0 )); then
    failed+=" $id"
    hits "$id" "$regex" "$files" | sed 's/^/    /'
  fi
done <<< "$patterns"

if (( strict )); then
  if [[ -n "$failed" ]]; then
    echo "Style census: FAIL (${failed# })"
    exit 1
  fi
  echo "Style census: OK"
fi
