const {
  envReady,
  isAuthenticated,
  verifyPassword,
  setAuthCookie,
  clearAuthCookie
}=require("./_site-auth");

function getBody(req){
  if(req.body&&typeof req.body==="object")return req.body;
  if(typeof req.body==="string"){
    try{return JSON.parse(req.body)}catch(_){return {}}
  }
  return {};
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","no-store, max-age=0");

  if(!envReady()){
    return res.status(503).json({
      error:"Vercel 환경변수 TRAVEL_SITE_PASSWORD / TRAVEL_AUTH_SECRET 설정이 필요합니다."
    });
  }

  if(req.method==="GET"){
    return res.status(200).json({authenticated:isAuthenticated(req)});
  }

  if(req.method==="POST"){
    const body=getBody(req);
    if(!verifyPassword(body.password)){
      await new Promise(resolve=>setTimeout(resolve,350));
      return res.status(401).json({error:"비밀번호가 올바르지 않습니다."});
    }
    setAuthCookie(res);
    return res.status(200).json({authenticated:true});
  }

  if(req.method==="DELETE"){
    clearAuthCookie(res);
    return res.status(200).json({authenticated:false});
  }

  res.setHeader("Allow","GET, POST, DELETE");
  return res.status(405).json({error:"지원하지 않는 요청 방식입니다."});
};
