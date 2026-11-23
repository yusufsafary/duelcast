// Live board for DuelCast (orspin.fun). Read-only eth_call, 4-RPC race.
// CONFIG: set DUELCAST_ADDRESS after deployment and rerun gen-site.py.
var DUELCAST_ADDRESS = "";
(function () {
  var FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"; // Chainlink BNB/USD on BSC
  var RPCS = [
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc.publicnode.com",
    "https://bsc-dataseed.bnbchain.org"
  ];
  var SEL = {
    latestRoundData: "0xfeaf968c",
    currentRound: "0x8a19c8bc",
    totalDuels: "0x57d628d7",
    totalSettled: "0xeace4c91",
    poolDuelOfRound: "0x9915351c",
    duels: "0x859a62d0", // duels(uint256), keccak-verified against the brief's selectors
    duelsOpen: "0xb6dc85a9"
  };
  var STATUS = ["Awaiting acceptance", "Active", "Settled", "Cancelled"];
  var chainRound = null;

  function arg(n) {
    var h = BigInt(n).toString(16);
    while (h.length < 64) h = "0" + h;
    return h;
  }
  function callOne(rpc, to, data) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 4000);
    return fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: to, data: data }, "latest"] }),
      signal: ctrl.signal
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(t);
      if (!j || !j.result || j.result === "0x") throw new Error("bad");
      return j.result;
    });
  }
  function callRaw(to, data) {
    return Promise.any(RPCS.map(function (rpc) { return callOne(rpc, to, data); }));
  }
  function call(to, data) {
    return callRaw(to, data).then(function (hex) { return BigInt(hex); });
  }
  function words(hex) {
    var h = hex.slice(2), out = [];
    for (var i = 0; i + 64 <= h.length; i += 64) out.push(BigInt("0x" + h.substr(i, 64)));
    return out;
  }
  function signed(v) { return v >= (1n << 255n) ? v - (1n << 256n) : v; }
  function addrOf(w) { return "0x" + w.toString(16).padStart(64, "0").slice(24); }
  function short(a) { return a.slice(0, 6) + "…" + a.slice(-4); }
  function fmt(n) { return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
  function priceOf(v) { // int256, 8 decimals
    var neg = v < 0n; if (neg) v = -v;
    var whole = v / 100000000n, cents = (v % 100000000n) / 1000000n;
    return (neg ? "-" : "") + "$" + fmt(whole) + "." + String(cents).padStart(2, "0");
  }
  function hourRound() { return Math.floor(Date.now() / 3600000); }

  function tick() {
    var now = new Date();
    var next = new Date(now); next.setUTCMinutes(60, 0, 0);
    var s = Math.max(0, Math.floor((next - now) / 1000));
    var hh = String(Math.floor(s / 3600)).padStart(2, "0"),
        mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0"),
        ss = String(s % 60).padStart(2, "0");
    set("dc-count", hh + ":" + mm + ":" + ss);
    var r = chainRound !== null ? chainRound : hourRound();
    set("dc-round", "Nº " + fmt(r));
  }

  function refreshPrice() {
    callRaw(FEED, SEL.latestRoundData).then(function (hex) {
      var w = words(hex);
      set("dc-price", priceOf(signed(w[1])));
      var at = new Date(Number(w[3]) * 1000);
      set("dc-price-at", "Chainlink print " + at.toISOString().slice(11, 19) + " UTC · feed 0x0567…2aeE");
      var dot = document.getElementById("dc-dot");
      if (dot) { dot.textContent = "Live · BSC"; dot.classList.add("live"); }
    }).catch(function () { /* keep last good values */ });
  }

  function renderLedger(rows) {
    var tb = document.getElementById("dc-ledger");
    if (!tb) return;
    tb.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      r.forEach(function (c) {
        var td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  function refreshContract() {
    if (!DUELCAST_ADDRESS) {
      set("dc-status", "Awaiting deployment · Contract address announced at launch");
      set("dc-pool", "Open pool opens at deployment. First flag planted takes the round's first rival.");
      set("hd-status", "Deployment pending · Address announced at launch");
      return;
    }
    call(DUELCAST_ADDRESS, SEL.currentRound).then(function (r) {
      chainRound = Number(r);
      set("hd-status", "Round Nº " + fmt(chainRound) + " · Live · Settles on the hour");
      return Promise.all([
        call(DUELCAST_ADDRESS, SEL.totalDuels),
        call(DUELCAST_ADDRESS, SEL.totalSettled),
        call(DUELCAST_ADDRESS, SEL.duelsOpen),
        call(DUELCAST_ADDRESS, SEL.poolDuelOfRound + arg(chainRound))
      ]).then(function (res) {
        var total = Number(res[0]);
        set("dc-duels", fmt(res[0]));
        set("dc-settled", fmt(res[1]));
        set("dc-open", fmt(res[2]));
        set("dc-status", "Live · DuelCast at " + short(DUELCAST_ADDRESS) + " · BSC");
        var poolId = Number(res[3]);
        if (poolId > 0) {
          set("dc-pool", "Open pool: duel Nº " + poolId + " is planted for round Nº " + fmt(chainRound) + " and waits for a rival.");
        } else {
          set("dc-pool", "Open pool is empty this round. openDuel with the zero address plants the first flag.");
        }
        if (total === 0) {
          renderLedger([["·", "·", "No duels yet", "Ledger fills from the first challenge", "·", "·"]]);
          return;
        }
        var ids = [];
        for (var i = total; i >= Math.max(1, total - 7); i--) ids.push(i);
        Promise.all(ids.map(function (id) {
          return callRaw(DUELCAST_ADDRESS, SEL.duels + arg(id)).then(function (hex) {
            var w = words(hex);
            var challenger = addrOf(w[0]), rival = addrOf(w[1]);
            var status = Number(w[5]);
            var standing;
            if (status === 2) {
              standing = w[11] === 1n ? "Draw · Split marks" : short(addrOf(w[9])) + " won";
            } else if (status === 1) {
              standing = w[6] === 1n ? "Challenger UP · Rival DOWN" : "Challenger DOWN · Rival UP";
            } else {
              standing = STATUS[status] || "Open";
            }
            return [String(id), fmt(w[2]), short(challenger),
                    rival === "0x0000000000000000000000000000000000000000" ? "Open pool" : short(rival),
                    priceOf(signed(w[3])), standing];
          }).catch(function () { return null; });
        })).then(function (rows) {
          renderLedger(rows.filter(Boolean));
        });
      });
    }).catch(function () { /* keep last good values */ });
  }

  tick();
  setInterval(tick, 1000);
  refreshPrice();
  refreshContract();
  setInterval(function () { refreshPrice(); refreshContract(); }, 30000);
})();
