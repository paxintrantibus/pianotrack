/* Pure audio-level state machine. No microphone or storage access here. */
(function(global){
  class Autopilot {
    constructor({quietMs=120000,resumeMs=3000,finishMs=900000,threshold=-42,onSegment=()=>{},onChange=()=>{}}={}){
      Object.assign(this,{quietMs,resumeMs,finishMs,threshold,onSegment,onChange});this.state='idle';this.total=0;this.start=null;this.last=null;this.quiet=null;this.loud=null;this.pausedAt=null;
    }
    begin(now){this.state='running';this.start=now;this.last=now;this.total=0;this.quiet=null;this.loud=null;this.onChange();}
    closeSegment(end){if(this.start!==null&&end>this.start){this.onSegment(this.start,end);this.total+=end-this.start}this.start=null;}
    sample(db,now){
      if(!['running','paused'].includes(this.state))return;
      if(this.last!==null&&(now-this.last>5000||now<this.last)){this.suspend(this.last);return;}
      this.last=now;
      if(this.state==='running'){
        this.quiet=db<this.threshold-6?(this.quiet??now):null;
        if(this.quiet!==null&&now-this.quiet>=this.quietMs){this.closeSegment(now);this.state='paused';this.pausedAt=now;this.loud=null;this.onChange();}
      }else{
        if(now-this.pausedAt>=this.finishMs){this.finish(now);return;}
        this.loud=db>=this.threshold?(this.loud??now):null;
        if(this.loud!==null&&now-this.loud>=this.resumeMs){this.start=this.loud;this.state='running';this.quiet=null;this.loud=null;this.onChange();}
      }
    }
    suspend(now){if(!['running','paused'].includes(this.state))return;this.closeSegment(Math.min(now,this.last??now));this.state='suspended';this.quiet=null;this.loud=null;this.onChange();}
    resume(now){if(this.state!=='suspended')return;this.state='running';this.start=now;this.last=now;this.quiet=null;this.loud=null;this.onChange();}
    finish(now){if(this.state==='idle')return;this.closeSegment(Math.min(now,this.last??now));this.state='idle';this.onChange();}
    elapsed(now){return this.total+(this.start===null?0:Math.max(0,now-this.start));}
    checkpoint(){return {state:this.state,total:this.total,start:this.start,last:this.last};}
    recover(data){
      if(!data||!['running','paused','suspended'].includes(data.state)||!Number.isFinite(data.total)||data.total<0)return;
      this.total=data.total;this.state='suspended';
      if(data.state==='running'&&Number.isFinite(data.start)&&Number.isFinite(data.last)&&data.last>data.start){this.start=data.start;this.closeSegment(data.last);}
      this.start=null;this.last=null;this.onChange();
    }
  }
  global.Autopilot=Autopilot;if(typeof module!=='undefined')module.exports=Autopilot;
})(globalThis);
