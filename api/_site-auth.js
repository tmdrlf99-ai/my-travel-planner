const crypto = require("crypto");

const COOKIE_NAME = "mtp_site_auth";
// Keep the login session for up to 400 days.
// The password itself does not expire or change automatically.
// Change TRAVEL_SITE_PASSWORD in Vercel only when the owner wants a new password.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

function envReady(){
  return Boolean(process.env.TRAVEL_SITE_PASSWORD && process.env.TRAVEL_AUTH_SECRET);
}

function parseCookies(header=""){
  const out={};
  String(header||"").split(";").forEach(part=>{
    const i=part.indexOf("=");
    if(i<0)return;
    const key=part.slice(0,i).trim();
    const value=part.slice(i+1).trim();
    if(key){
      try{out[key]=decodeURIComponent(value)}
      catch(_){out[key]=value}
    }
  });
  return out;
}

function safeEqual(a,b){
  const aa=Buffer.from(String(a||""));
  const bb=Buffer.from(String(b||""));
  if(aa.length!==bb.length)return false;
  return crypto.timingSafeEqual(aa,bb);
}

function expectedToken(){
  const secret=process.env.TRAVEL_AUTH_SECRET||"";
  const password=process.env.TRAVEL_SITE_PASSWORD||"";
  return crypto.createHmac("sha256",secret)
    .update(`my-travel-planner:v1:${password}`)
    .digest("hex");
}

function isAuthenticated(req){
  if(!envReady())return false;
  const cookies=parseCookies(req.headers?.cookie||"");
  return safeEqual(cookies[COOKIE_NAME]||"",expectedToken());
}

function verifyPassword(input){
  if(!envReady())return false;
  return safeEqual(String(input??""),String(process.env.TRAVEL_SITE_PASSWORD||""));
}

function setAuthCookie(res){
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(expectedToken())}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearAuthCookie(res){
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  );
}

module.exports={envReady,isAuthenticated,verifyPassword,setAuthCookie,clearAuthCookie};
