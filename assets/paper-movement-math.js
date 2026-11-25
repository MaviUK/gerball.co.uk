(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.GerballOddsMovement=factory();})(typeof globalThis!=='undefined'?globalThis:null,function(){'use strict';
function analyse(row){
 const original=Number(row?.original_odds),next=Number(row?.latest_fixed_odds),prob=Number(row?.model_probability);
 if(![original,next,prob].every(Number.isFinite)||original<=1||next<=1||prob<=0||prob>=1)return null;
 const movement=Number(((next/original-1)*100).toFixed(2)),oldEdge=Number(((prob*original-1)*100).toFixed(2)),newEdge=Number(((prob*next-1)*100).toFixed(2));
 return{movement,oldEdge,newEdge,preserved:prob*next>1,
 direction:next>original?'higher':next<original?'lower':'unchanged'};
}
return{analyse};
});