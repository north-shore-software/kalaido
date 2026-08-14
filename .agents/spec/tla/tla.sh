#!/usr/bin/env bash
set -e

# Go to the directory of the script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

TLA_JAR="tla2tools.jar"
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"
HTML_FILE="view_diagrams.html"

print_usage() {
    echo "Usage: ./tla.sh <command> [model]"
    echo ""
    echo "Commands:"
    echo "  check [model]       - Run the model checker. Default model: MC"
    echo "                        e.g. ./tla.sh check lifecycle  -> MC_lifecycle.{tla,cfg}"
    echo "  autodiagram [model] - Run a TLA+ VIEW to autogenerate a state graph from the"
    echo "                        math, and view it. Default model: diagram"
    echo "                        e.g. ./tla.sh autodiagram diag_proj"
    echo "  viz                 - Generate the HTML viewer for the hand-written @mermaid"
    echo "                        blocks and open it."
    echo "  all                 - Run 'check' followed by 'viz'."
    echo "  clean               - Remove temporary traces, states directory, and generated"
    echo "                        HTML/DOT files."
    echo ""
    echo "Models:"
    echo "  MC             - the main spec (grid, clock, liveness)"
    echo "  MC_lifecycle   - Lifecycle.tla invariants"
    echo "  MC_diag_proj   - Projection lifecycle state machine (diagram)"
    echo "  MC_diag_refl   - Reflection window lifecycle state machine (diagram)"
}

# Resolve a short model name to its MC module: "" -> MC, "lifecycle" -> MC_lifecycle.
# The MC_ form is tried first: this tree is often mounted case-insensitively, where a
# bare "lifecycle" would otherwise match the spec module Lifecycle.tla, which has no cfg.
resolve_model() {
    if [ -z "$1" ] || [ "$1" = "MC" ]; then
        echo "MC"
    elif [ -f "MC_$1.cfg" ]; then
        echo "MC_$1"
    else
        echo "$1"
    fi
}

download_jar() {
    if [ ! -f "$TLA_JAR" ]; then
        echo "[*] Downloading TLA+ tools..."
        curl -L "$TLA_URL" -o "$TLA_JAR"
    else
        echo "[*] TLA+ tools already downloaded."
    fi
}

# Remove only this model's scratch state. Deleting all of states/ here would kill
# a concurrently running model's metadir mid-run, which surfaces as an opaque
# "StatePoolWriter disk error" in the *other* process. The lifecycle model takes
# several minutes, so wanting to generate a diagram meanwhile is entirely normal.
clean_tmp() {
    echo "[*] Cleaning up temporary TLC files for ${1:-all models}..."
    if [ -n "$1" ]; then rm -rf "states/$1" "states/${1}_gate"; else rm -rf states/; fi
    rm -f "${1:-MC}"_TTrace_*.tla "${1:-MC}"_TTrace_*.bin
}

run_check() {
    MODEL=$(resolve_model "$1")
    echo "=== Kalaido TLA+ Checker ($MODEL) ==="
    download_jar

    if ! command -v java &> /dev/null; then
        echo "[-] Error: 'java' is not installed or not in PATH."
        exit 1
    fi

    if [ ! -f "$MODEL.tla" ] || [ ! -f "$MODEL.cfg" ]; then
        echo "[-] Error: $MODEL.tla or $MODEL.cfg not found."
        exit 1
    fi

    clean_tmp "$MODEL"

    echo "[*] Running TLC Model Checker..."
    # A metadir can reach gigabytes, so clear this model's whether TLC succeeds
    # or fails — but never touch another model's.
    trap 'rm -rf "states/$MODEL"' EXIT
    # -metadir keeps each model's scratch state separate. Without it, two TLC runs in
    # this directory share states/ and one dies with a StatePoolWriter disk error.
    java -XX:+UseParallelGC -cp "$TLA_JAR" tlc2.TLC "$MODEL.tla" -config "$MODEL.cfg" \
         -metadir "states/$MODEL" -workers auto
}

run_autodiagram() {
    MODEL=$(resolve_model "${1:-diagram}")
    download_jar
    clean_tmp "$MODEL"

    if [ ! -f "$MODEL.tla" ] || [ ! -f "$MODEL.cfg" ]; then
        echo "[-] Error: $MODEL.tla or $MODEL.cfg not found."
        exit 1
    fi

    echo "[*] Running TLC over the full state space ($MODEL)..."
    # The abstraction is applied AFTER a complete search, not during it.
    #
    # TLC's VIEW looks like the natural tool here, and it is a trap. VIEW keeps one
    # representative per equivalence class and never expands the others, so the
    # graph it emits is a *subgraph* of the true abstract machine: any transition
    # only enabled in a discarded representative is silently absent. That produced
    # a diagram asserting "Preview (stale) --ApprovePreview--> Idle", the exact
    # opposite of what §Resolution of Staleness requires. TLC's `-view` flag is
    # worse still, truncating the search outright (6 states explored, against 5619).
    #
    # So: search the full space with no VIEW, then collapse the dump by the `phase`
    # variable below. The result is the exact image of the reachable graph under
    # the abstraction — complete by construction, with no gate needed.
    grep -v '^[[:space:]]*VIEW' "$MODEL.cfg" > "_full_$MODEL.cfg"
    java -cp "$TLA_JAR" tlc2.TLC "$MODEL.tla" -config "_full_$MODEL.cfg" \
         -metadir "states/$MODEL" -dump dot,actionlabels raw.dot > tlc_out.txt 2>&1 || true
    rm -rf "states/$MODEL" "_full_$MODEL.cfg"

    if [ ! -f raw.dot ]; then
        echo "[-] Error: TLC failed to generate a state graph."
        cat tlc_out.txt; rm -f tlc_out.txt; exit 1
    fi
    if ! grep -q "Model checking completed" tlc_out.txt; then
        echo "[!] WARNING: TLC did not complete. The diagram may be partial."
        grep -E "Error|violated" tlc_out.txt | head -5
    fi
    echo "[*] $(grep -oE '[0-9,]+ distinct states found' tlc_out.txt | head -1) in the full space"
    rm -f tlc_out.txt

    AUTO_HTML="view_autodiagram_${MODEL}.html"
    echo "[*] Collapsing by phase and generating $AUTO_HTML..."

    # Node lines carry a full state dump containing `phase`; edge lines are
    # identified by `$2 == "->"` rather than by searching for "->" anywhere,
    # because TLA+ record syntax (`[id |-> 1]`) puts an arrow inside every dump.
    awk '
    function phase_of(line,   p, rest, n, q) {
        p = index(line, "phase = "); if (p == 0) return ""
        rest = substr(line, p + 8)
        n = index(rest, "\\n")
        if (n > 0) rest = substr(rest, 1, n - 1)
        else { n = index(rest, "\","); if (n > 0) rest = substr(rest, 1, n - 1) }
        q = index(rest, ":> "); if (q > 0) rest = substr(rest, q + 3)
        sub(/^\\"/, "", rest); sub(/\\"\)[ ]*$/, "", rest)
        return rest
    }
    $2 == "->" { e[$1 "|" $3] = 1; ea[$1 "|" $3] = act_of($0); next }
    function act_of(line,   a) {
        if (match(line, /label="[A-Za-z]+\(/))
            return substr(line, RSTART + 7, RLENGTH - 8)
        return "?"
    }
    /\[label="/ {
        ph[$1] = phase_of($0)
        if ($0 ~ /style = filled/) init[$1] = 1
        next
    }
    END {
        print "strict digraph Lifecycle {"
        print "  rankdir=TB; nodesep=0.4; ranksep=0.55;"
        print "  node [shape=box,style=\"rounded,filled\",fillcolor=\"#eef2ff\",fontname=\"Helvetica\",fontsize=11];"
        print "  edge [fontname=\"Helvetica\",fontsize=9,color=\"#555555\",fontcolor=\"#333333\"];"
        for (n in ph) {
            if (ph[n] == "" || seen[ph[n]]++) continue
            extra = ""
            for (m in init) if (ph[m] == ph[n]) extra = ",penwidth=2,color=\"#3355bb\""
            print "  \"" ph[n] "\" [" substr(extra, 2) "];"
        }
        for (k in e) {
            split(k, ab, "|")
            a = ph[ab[1]]; b = ph[ab[2]]
            if (a == "" || b == "") continue
            key = a "\x01" ea[k] "\x01" b
            if (edone[key]++) continue
            print "  \"" a "\" -> \"" b "\" [label=\"" ea[k] "\"];"
        }
        print "}"
    }
    ' raw.dot > diagram_clean.dot

    NODES=$(grep -cE '^  "[^"]+" \[' diagram_clean.dot)
    EDGES=$(grep -cE '^  "[^"]+" -> ' diagram_clean.dot)
    echo "[*] Abstract machine: $NODES states, $EDGES transitions"

    DOT_B64=$(base64 < diagram_clean.dot | tr -d '\n')
    rm -f raw.dot diagram_clean.dot

    cat << EOF > "$AUTO_HTML"
<!DOCTYPE html>
<html>
<head>
    <title>Kalaido Auto-Generated State Graph</title>
    <script src="https://cdn.jsdelivr.net/npm/@viz-js/viz@3.2.0/lib/viz-standalone.js"></script>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f9; padding: 40px; color: #333; }
        .container { max-width: 1000px; margin: 0 auto; text-align: center; }
        .diagram-card { background: white; padding: 30px; margin-bottom: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        h1 { margin-bottom: 10px; }
        p.subtitle { color: #666; margin-bottom: 30px; }
        svg { max-width: 100%; height: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Auto-Generated TLA+ State Machine</h1>
        <p class="subtitle">This Graphviz diagram was dynamically generated directly from the mathematical state space using TLA+ VIEWs.</p>
        <div class="diagram-card" id="graph"></div>
    </div>
    <script>
        // Decode the base64 DOT file safely
        const dot = atob("$DOT_B64");
        Viz.instance().then(function(viz) {
            document.getElementById("graph").appendChild(viz.renderSVGElement(dot));
        });
    </script>
</body>
</html>
EOF

    echo "[*] Opening auto-diagram..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$AUTO_HTML"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] && command -v xdg-open &> /dev/null; then
        xdg-open "$AUTO_HTML" &
    else
        echo "[!] Could not automatically open the browser."
        echo "    Please manually open this file in your browser: file://$DIR/$AUTO_HTML"
    fi
}

run_viz() {
    echo "=== Kalaido Diagram Visualizer ==="
    echo "[*] Extracting diagrams from TLA+ spec..."
    
    # We use awk to extract blocks between \* @mermaid and \* @end, 
    # stripping the leading "\* " from each line.
    awk '
        /\\\* @mermaid/ { 
            in_block = 1; 
            name = $3; 
            print "        <div class=\"diagram-card\">";
            print "            <h2>" name "</h2>";
            print "            <div class=\"mermaid\">";
            next; 
        }
        /\\\* @end/ { 
            if (in_block) {
                print "            </div>";
                print "        </div>";
                in_block = 0; 
            }
            next; 
        }
        in_block { 
            sub(/^\\\*[ \t]*/, ""); 
            print; 
        }
    ' Kalaido.tla > tmp_diagrams.html

    if [ ! -s tmp_diagrams.html ]; then
        echo "[!] No embedded @mermaid blocks found in Kalaido.tla!"
        rm -f tmp_diagrams.html
        exit 1
    fi

    echo "[*] Generating HTML diagram viewer ($HTML_FILE)..."

    cat << 'EOF' > "$HTML_FILE"
<!DOCTYPE html>
<html>
<head>
    <title>Kalaido TLA+ State Machines</title>
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
        mermaid.initialize({ startOnLoad: true, theme: 'default' });
    </script>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f9; padding: 40px; color: #333; }
        .container { max-width: 1200px; margin: 0 auto; }
        .diagram-card { background: white; padding: 30px; margin-bottom: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        h1 { text-align: center; margin-bottom: 40px; }
        h2 { margin-top: 0; color: #555; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 20px;}
        .mermaid { display: flex; justify-content: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Kalaido Domain Model - State Machines</h1>
EOF

    cat tmp_diagrams.html >> "$HTML_FILE"

    cat << 'EOF' >> "$HTML_FILE"
    </div>
</body>
</html>
EOF

    rm -f tmp_diagrams.html

    echo "[*] Opening diagrams..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$HTML_FILE"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] && command -v xdg-open &> /dev/null; then
        xdg-open "$HTML_FILE" &
    else
        echo "[!] Could not automatically open the browser."
        echo "    Please manually open this file in your browser: file://$DIR/$HTML_FILE"
    fi
}

case "$1" in
    check)
        run_check "$2"
        ;;
    viz)
        run_viz
        ;;
    autodiagram)
        run_autodiagram "$2"
        ;;
    all)
        run_check "$2"
        run_viz
        run_autodiagram
        ;;
    clean)
        clean_tmp
        echo "[*] Removing generated HTML and DOT files"
        rm -f "$HTML_FILE" view_autodiagram*.html diagram.dot diagram_clean.dot
        ;;
    *)
        print_usage
        exit 1
        ;;
esac

echo "=== Done ==="
