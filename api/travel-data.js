// MY TRAVEL PLANNER v5.9.1 - Vercel same-origin sync proxy
// 브라우저 -> /api/travel-data -> Supabase
// 회사망에서 *.supabase.co 직접 접속이 막혀도 Vercel 경유로 동기화합니다.

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://cqlcdexexsujklpwnyvy.supabase.co";const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_7RaNiiyEa6XuDZzAgyO5Jg_uDI-l5hj";
const ALLOWED = new Set(["travel_trips","travel_events","travel_budgets","travel_places"]);
const READ_QUERY = {
  travel_trips: "select=*&is_visible=eq.true&order=start_date.asc.nullslast",
  travel_events: "select=*&is_visible=eq.true&order=event_date.asc",
  travel_budgets: "select=*&order=sort_order.asc",
  travel_places: "select=*&order=created_at.desc"
};

async function sbFetch(table, method="GET", body=null, id=null){
  if(!ALLOWED.has(table)) throw new Error("허용되지 않은 데이터 테이블입니다.");
  let query = method==="GET" ? READ_QUERY[table] : (id!=null ? `id=eq.${encodeURIComponent(id)}` : "");
  const url = `${SUPABASE_URL}/rest/v1/${table}${query?`?${query}`:""}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Accept: "application/json"
  };
  // sb_publishable_/sb_secret_ 키는 JWT가 아니므로 Authorization Bearer에 넣지 않습니다.
  // 레거시 eyJ... JWT 키를 환경변수로 쓰는 경우에만 Bearer를 추가합니다.
  if(/^eyJ/.test(SUPABASE_KEY)) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  if(body!==null){headers["Content-Type"]="application/json";headers.Prefer="return=representation"}
  if(method==="DELETE") headers.Prefer="return=representation";
  const response = await fetch(url,{method,headers,body:body!==null?JSON.stringify(body):undefined});
  const raw = await response.text();
  let data=null;try{data=raw?JSON.parse(raw):null}catch(_){data=raw}
  if(!response.ok){
    const detail=(data&&typeof data==="object"&&(data.message||data.details||data.hint))||raw||`HTTP ${response.status}`;
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  if((method==="POST"||method==="PATCH")&&Array.isArray(data)) return data[0]||null;
  return data;
}

module.exports = async function handler(req,res){
  res.setHeader("Cache-Control","no-store, max-age=0");
  try{
    if(req.method==="GET" && (req.query.table==="all" || !req.query.table)){
      const [trips,events,budgets,places]=await Promise.all([
        sbFetch("travel_trips"),sbFetch("travel_events"),sbFetch("travel_budgets"),sbFetch("travel_places")
      ]);
      return res.status(200).json({data:{trips,events,budgets,places}});
    }
    const table=req.query.table;
    if(!ALLOWED.has(table)) return res.status(400).json({error:"허용되지 않은 table 값입니다."});
    if(req.method==="GET") return res.status(200).json({data:await sbFetch(table)});
    if(req.method==="POST") return res.status(200).json({data:await sbFetch(table,"POST",req.body||{})});
    const id=req.query.id;
    if((req.method==="PUT"||req.method==="DELETE")&&!id) return res.status(400).json({error:"id가 필요합니다."});
    if(req.method==="PUT") return res.status(200).json({data:await sbFetch(table,"PATCH",req.body||{},id)});
    if(req.method==="DELETE") return res.status(200).json({data:await sbFetch(table,"DELETE",null,id)});
    res.setHeader("Allow","GET, POST, PUT, DELETE");
    return res.status(405).json({error:"지원하지 않는 요청 방식입니다."});
  }catch(err){
    console.error("travel-data proxy error",err);
    return res.status(502).json({error:{message:err.message||"동기화 서버 오류",name:err.name||"Error"}});
  }
};
