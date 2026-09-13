"""Walk the whole shop in-process: the three pauses, a duplicate, and a refund.

    uv run python scripts/smoke.py
"""
import asyncio, json, sys
sys.path.insert(0, ".")
import street.service as svc
from google.genai import types


async def turn(sid, text=None, delivered=False, stamp=None, purse=None):
    label = text or ("🔔 the courier knocks" if delivered else f"🖋 stamp={stamp}")
    print(f"\n>>> {label}")
    if delivered:
        sess = await svc._sessions.get_session(app_name=svc.APP, user_id=svc.USER, session_id=sid)
        _, parcel = svc._pending(sess)
        if not parcel:
            print("   (nothing out for delivery)"); return
        msg = types.Content(role="user", parts=[types.Part(function_response=types.FunctionResponse(
            id=parcel["call_id"], name="hand_to_courier",
            response={"status": "delivered", "ticket": parcel["order"]}))])
    elif stamp is not None:
        msg = types.Content(role="user", parts=[svc.create_request_input_response(
            "till:stamp", {"ok": stamp, "note": "" if stamp else "worn already"})])
    else:
        msg = types.Content(role="user", parts=[types.Part(text=text)])
    async for chunk in svc._run(sid, msg, purse=purse):
        d = json.loads(chunk[6:]); k = d.pop("kind")
        if k == "graph": continue
        if k == "node":
            print(f"   {d['node']:<9} {d['text'][:78]}{'  Δ' + ','.join(d['delta']) if d['delta'] else ''}")
        elif k == "interrupt":
            print(f"   ⏸ INTERRUPT {d['node']} · {d['message']}")
        elif k == "state":
            st = d["state"]
            print(f"   ── purse {st.get('user:sparks')} · shelf {st.get('app:stock')} "
                  f"· ledger { {k2: v['status'] for k2, v in (st.get('orders') or {}).items()} }")
            if d.get("waiting"): print("   ── holding a QUESTION:", d["waiting"]["message"])
            if d.get("parcel"): print("   ── holding a PARCEL:", d["parcel"]["order"])
        else:
            print(f"   {k}: {json.dumps(d)[:120]}")


async def main():
    sid = "smoke-" + str(abs(hash(str(sys.argv))) % 9999)
    await turn(sid, "I'd like to buy something", purse=30)      # pause 1 · the desk asks
    await turn(sid, "the star lantern please")                  # → pause 2 · the courier
    await turn(sid, delivered=True)                             # 🔔 → charge, grant, reply
    await turn(sid, "buy the star lantern again, order #dup1")
    await turn(sid, delivered=True)
    await turn(sid, "buy the star lantern again, order #dup1")  # the retry
    await turn(sid, delivered=True)                             # guard should bite here
    await turn(sid, "I'd like to return my last order")         # → pause 3 if approve is wired
    await turn(sid, stamp=True)

asyncio.run(main())
