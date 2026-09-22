
/* Rectilinear ideal imaging on an 18 mm circular photocathode.
 * The M42 template always spans 0.5005 degrees on the sky.
 * The afocal mapping uses ideal paraxial angular magnification in tangent space.
 */
(function(root){
  'use strict';
  const DEG=Math.PI/180,RADIUS=9,FIELD=.5005;
  function geometry(c){
    const afocal=c.position.startsWith('afocal');
    const magnification=afocal?600/c.eyepieceFocal:1;
    const focal=afocal?magnification*c.nvFocal:c.focalLength;
    const angleFocal=afocal?c.nvFocal:focal;
    return {afocal,magnification,focal,angleFocal,radius:RADIUS,
      halfSky:Math.atan(RADIUS/focal)/DEG,halfControl:Math.atan(RADIUS/angleFocal)/DEG};
  }
  function projection(c){
    const g=geometry(c),a=(c.targetAngle||0)*DEG;
    const sky=g.afocal?Math.atan(Math.tan(a)/g.magnification):a;
    const sin=Math.sin(sky),cos=Math.cos(sky);
    return function(dxDeg,dyDeg){
      const u=Math.tan(dxDeg*DEG),v=Math.tan(dyDeg*DEG),z=cos-sin*u;
      const x=g.focal*(cos*u+sin)/z,y=g.focal*v/z,r=Math.hypot(x,y);
      return {x,y,r,inside:z>0&&r<=RADIUS,angle:Math.atan(r/g.angleFocal)/DEG};
    };
  }
  function target(c){
    const project=projection(c),center=project(0,0);
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>project(x*FIELD/2,y*FIELD/2));
    return {center,corners};
  }
  function unprojection(c){
    const g=geometry(c),a=(c.targetAngle||0)*DEG;
    const sky=g.afocal?Math.atan(Math.tan(a)/g.magnification):a;
    const sin=Math.sin(sky),cos=Math.cos(sky);
    return function(x,y){
      const u=x/g.focal,v=y/g.focal,z=sin*u+cos;
      return {dx:Math.atan((cos*u-sin)/z)/DEG,dy:Math.atan(v/z)/DEG};
    };
  }
  const api={geometry,projection,unprojection,target,FIELD,RADIUS};
  root.M42Field=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

