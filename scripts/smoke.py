"""Run the street in-process, no HTTP: prints every stream event.

    uv run python scripts/smoke.py "buy the Star Lantern · order #k7f2" "buy the Star Lantern · order #k7f2" "return the lantern" "what am I wearing?"
"""
import asyncio, json, sys
sys.path.insert(0, ".")
import street.service as svc

async def main(msgs):
    sid = "smoke-1"
    from google.genai import types
    for m in msgs:
        print(f"\n>>> {m}")
        if m.startswith("STAMP"):
            ok = "yes" in m
            gen = svc._run(sid, types.Content(role="user", parts=[
                svc.create_request_input_response("till:stamp", {"ok": ok, "note": "" if ok else "not today"})]))
        else:
            gen = svc._run(sid, types.Content(role="user", parts=[types.Part(text=m)]), purse=12)
        async for chunk in gen:
            d = json.loads(chunk[6:])
            k = d.pop("kind")
            if k == "graph": continue
            if k == "node": print(f"  {d['node']:<8} {d['text'][:90]}{'  Δ' + ','.join(d['delta']) if d['delta'] else ''}{'  → ' + d['route'] if d['route'] else ''}")
            elif k == "state": print(f"  STATE purse={d['state'].get('user:sparks')} orders={d['state'].get('orders')} case={d['state'].get('case')} waiting={bool(d['waiting'])} temp={[k for k in d['state'] if k.startswith('temp:')]}")
            else: print(f"  {k}: {json.dumps(d)[:160]}")
asyncio.run(main(sys.argv[1:]))
