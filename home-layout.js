// Pixel bounds keep the animation separate from its text and touch controls.
// This describes composition only; the opening/flip timeline stays in app.js.
export function compactHomeViewport(width,height) {
  return width<=760||(width<=950&&height<=540);
}

export function homeSceneLayout({width,height,headerBottom=131,copyBottom=350,revealTop=height-250,footerTop=height-44,packAspect=1.83,cardAspect=1.4}={}) {
  const landscape=width>height&&height<=540;
  const region=(left,right,top,bottom,preferredHeight,aspect)=>{
    const available=Math.max(1,bottom-top),imageHeight=Math.max(1,Math.min(preferredHeight,available,(right-left)*aspect));
    return {centerX:(left+right)/2,centerY:top+available/2,height:imageHeight,width:imageHeight/aspect,top:top+(available-imageHeight)/2,bottom:top+(available+imageHeight)/2};
  };
  if(landscape){
    return {landscape,initial:region(width*.60,width*.94,headerBottom+12,footerTop-16,250,packAspect),final:region(width*.60,width*.94,30,footerTop-12,290,cardAspect)};
  }
  return {landscape,
    initial:region(width*.21,width*.79,copyBottom+18,footerTop-56,340,packAspect),
    final:region(width*.13,width*.87,36,revealTop-22,400,cardAspect)};
}
