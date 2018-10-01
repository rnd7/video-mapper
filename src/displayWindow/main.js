'use strict';

// Imports
const electron = require('electron')
const {ipcRenderer, remote} = electron
const path = require("path")
const fs = require("fs")

var Stats = require('stats-js')
var THREE = require('three')

const nativeImage = require('electron').nativeImage
let testPattern = new THREE.TextureLoader().load("../../assets/test_pattern.png")
console.log(testPattern)

const WarpShader = {
	uniforms: {
    "showMasked" :  { type: "i", value: 1 },
    "useMask" :  { type: "i", value: 0 },
    "useVignette" :  { type: "i", value: 1 },
    "aspect" :  { type: "f", value: 1 },
    "mask": { type:'t', value: null },
    "diffuse": { type:'t', value: null },
		"size":   { type:'f', value: 1.0 },
		"smooth": { type:'f', value: 1. },
	},
	vertexShader: [
    "attribute vec3 warp;",
    "uniform float aspect;",
    "varying vec2 vUv;",
    "varying vec3 vWarp;",
    "void main() {",
			"vUv = uv;",
      "vWarp = warp;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
		"}"
	].join( "\n" ),
	fragmentShader: [
    "uniform int showMasked;",
    "uniform int useMask;",
    "uniform int useVignette;",
    "uniform float aspect;",
		"uniform float size;",
		"uniform float smooth;",
    "uniform sampler2D mask;",
    "uniform sampler2D diffuse;",
    "varying vec2 vUv;",
    "varying vec3 vWarp;",
    "void main() {",
      "vec2 uvq = vec2(vWarp.x/vWarp.z, 1.-(vWarp.y/vWarp.z));",
      "vec4 diffuseCol = texture2D(diffuse, uvq);",
      "if (useVignette == 1) {",
			  "float dist = distance(uvq, vec2( 0.5 ));",
        "diffuseCol *= smoothstep(1., size * 0.5, dist * (smooth + size));",
      "}",
      "if (useMask == 1) {",
        "vec4 maskCol = texture2D(mask, uvq);",
        "if (showMasked == 1) {",
          "maskCol.r = clamp(maskCol.r, .5, 1.);",
        "}",
        "diffuseCol = vec4(diffuseCol.rgb*maskCol.r, diffuseCol.a*maskCol.r);",
      "}",
      "gl_FragColor = diffuseCol;",
    "}",
	].join( "\n" )
}




function makePositionBuffer(position, bottomLeft, bottomRight, topRight, topLeft) {

		var bufferIndex = 0
    position[bufferIndex++] = bottomLeft.x
    position[bufferIndex++] = bottomLeft.y
    position[bufferIndex++] = 0
    position[bufferIndex++] = bottomRight.x
    position[bufferIndex++] = bottomRight.y
    position[bufferIndex++] = 0
    position[bufferIndex++] = topRight.x
    position[bufferIndex++] = topRight.y
    position[bufferIndex++] = 0
    position[bufferIndex++] = topLeft.x
    position[bufferIndex++] = topLeft.y
    position[bufferIndex++] = 0

    return position
}

function makeUVBuffer(uvs, bottomLeft, bottomRight, topRight, topLeft) {

		var bufferIndex = 0
    uvs[bufferIndex++] = bottomLeft.x
    uvs[bufferIndex++] = bottomLeft.y
    uvs[bufferIndex++] = bottomRight.x
    uvs[bufferIndex++] = bottomRight.y
    uvs[bufferIndex++] = topRight.x
    uvs[bufferIndex++] = topRight.y
    uvs[bufferIndex++] = topLeft.x
    uvs[bufferIndex++] = topLeft.y

    return uvs
}

function makeWarpBuffer(warp, bottomLeft, bottomRight, topRight, topLeft) {
		var ax = topRight.x - bottomLeft.x;
		var ay = topRight.y - bottomLeft.y;
		var bx = topLeft.x - bottomRight.x;
		var by = topLeft.y - bottomRight.y;
  	var cross = ax * by - ay * bx;

		if (cross != 0) {
			var cy = bottomLeft.y - bottomRight.y;
			var cx = bottomLeft.x - bottomRight.x;

			var s = (ax * cy - ay * cx) / cross;

			if (s > 0 && s < 1) {
				var t = (bx * cy - by * cx) / cross;

				if (t > 0 && t < 1) {
					//uv coordinates for texture
					var u0 = 0 // texture bottom left u
					var v0 = 0 // texture bottom left v
					var u2 = 1 // texture top right u
					var v2 = 1 // texture top right v

					var bufferIndex = 0;

					var q0 = 1 / (1 - t)
					var q1 = 1 / (1 - s)
					var q2 = 1 / t
					var q3 = 1 / s

          // bl
					warp[bufferIndex++] = u0 * q0
					warp[bufferIndex++] = v2 * q0
					warp[bufferIndex++] = q0

					warp[bufferIndex++] = u2 * q1;
					warp[bufferIndex++] = v2 * q1;
					warp[bufferIndex++] = q1;

					warp[bufferIndex++] = u2 * q2;
					warp[bufferIndex++] = v0 * q2;
					warp[bufferIndex++] = q2;

					warp[bufferIndex++] = u0 * q3;
					warp[bufferIndex++] = v0 * q3;
					warp[bufferIndex++] = q3;

				}
			}
		}
    return warp
}

function makeNormalBuffer(normal, bottomLeft, bottomRight, topRight) {

    const MULT = 32767 // MAX INT

    var pA = new THREE.Vector3(bottomLeft.x, bottomLeft.y, 0.)
    var pB = new THREE.Vector3(bottomRight.x, bottomRight.y, 0.)
    var pC = new THREE.Vector3(topRight.x, topRight.y, 0.)

    var cb = new THREE.Vector3()
    var ab = new THREE.Vector3()

    // tri 1 is enough
		cb.subVectors(pC, pB)
		ab.subVectors(pA, pB)
		cb.cross(ab)
		cb.normalize()

    cb.multiplyScalar(MULT)

    var bufferIndex = 0
    for (bufferIndex; bufferIndex<normal.length; bufferIndex+=3) {
  		normal[bufferIndex] = cb.x;
  		normal[bufferIndex+1] = cb.y;
  		normal[bufferIndex+2] = cb.z;
    }
    return normal
}

function makeQuad() {
  var t = {}
  t.scene = new THREE.Scene()
  t.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 3)
  t.camera.updateProjectionMatrix()
  t.camera.position.z = 2

  t.useVignette = true

  t.geometry = new THREE.BufferGeometry()

  t.bl = new THREE.Vector2(0, 0)
  t.br = new THREE.Vector2(1, 0)
  t.tr = new THREE.Vector2(1, 1)
  t.tl = new THREE.Vector2(0, 1)

  var position = new Float32Array(4*3)
  var warp = new Float32Array(4*3);
  var normal = new Float32Array(4*3)
  var uv = new Float32Array(4*2)

  makePositionBuffer(position, t.bl, t.br, t.tr, t.tl)
  makeWarpBuffer(warp, t.bl, t.br, t.tr, t.tl)
  makeNormalBuffer(normal, t.bl, t.br, t.tr) // from first tri only
  makeUVBuffer(
    uv,
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1, 0),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(0, 1)
  )
  var index = new Uint32Array([
    0, 1, 2, 2, 3, 0
  ])

	t.geometry.setIndex( new THREE.BufferAttribute(index, 1) );
  t.geometry.addAttribute('position', new THREE.BufferAttribute(position, 3));
  t.geometry.addAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
  t.geometry.addAttribute('warp', new THREE.BufferAttribute(warp, 3));
	t.geometry.addAttribute('normal', new THREE.BufferAttribute( normal, 3, true ) );

  t.material = new THREE.ShaderMaterial(WarpShader)
  t.mesh = new THREE.Mesh(t.geometry, t.material)
  t.mesh.position.z = 0

  t.scene.add(t.mesh)

  t.setSize = function(width, height) {
    t.width = width || 512
    t.height = height || 512
    t.camera.updateProjectionMatrix()
    t.updatePoints()
  }

  t.updateVignette = function() {
    t.material.uniforms.useVignette.value = t.useVignette;
    t.material.uniforms.useVignette.needsUpdate = true;
  }

  t.updatePoints = function() {
    makePositionBuffer(position, t.bl, t.br, t.tr, t.tl)
    makeWarpBuffer(warp, t.bl, t.br, t.tr, t.tl)
    t.geometry.attributes.position.needsUpdate = true;
    t.geometry.attributes.warp.needsUpdate = true;
  }
  t.setTexture = function(texture) {
    t.material.uniforms.diffuse.value = texture
  }
  t.setMask = function(texture) {
    t.material.uniforms.mask.value = texture
  }
  return t
}

function makeStage(width, height) {
  var t = {}

  t.useTestPattern = false

  t.width = width || 512
  t.height = height || 512

  t.buffer = new THREE.WebGLRenderTarget(
      64, 64,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter}
  )

  t.scene = new THREE.Scene()
  t.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100)
  t.camera.position.z = 10


  t.loaded = false
  t.video = document.createElement("VIDEO")
  t.video.autoplay = true
  t.video.loop = true
  t.video.controls = false
  t.video.muted = true
  t.video.addEventListener('loadeddata', function() {
      console.log("video loaded")
      t.loaded = true
      t.material.needsUpdate = true
      t.buffer.setSize(
        t.video.videoWidth||64,
        t.video.videoHeight||64
      )
  })
  console.log(t.video)


  t.texture = new THREE.VideoTexture(t.video)
  t.texture.minFilter = THREE.LinearFilter
  t.texture.magFilter = THREE.LinearFilter;
  t.texture.format = THREE.RGBFormat
  t.material = new THREE.MeshBasicMaterial({map : t.texture})
  //t.material = new THREE.MeshBasicMaterial({map: testPattern })

  t.geometry = new THREE.PlaneBufferGeometry(2, 2)

  t.mesh = new THREE.Mesh(t.geometry, t.material)


  t.scene.add(t.mesh)


  t.updateTexture = function() {
    if(t.useTestPattern) {
      t.material.map = testPattern
    } else {
      t.material.map = t.texture
    }
    t.material.needsUpdate = true
  }

  t.setSrc = function(src) {
    console.log("set video source", src)
    t.video.src = src
    t.loaded = false
  }
  return t
}


function makeMask(width, height) {
  var t = {}
  t.width = width || 512
  t.height = height || 512
  t.points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(1, 0),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(0, 1)
  ]

  t.buffer = new THREE.WebGLRenderTarget(
      t.width, t.height,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter}
  )

  t.scene = new THREE.Scene()
  t.camera = new THREE.OrthographicCamera(0, t.width, t.height, 0, 1, 100)
  t.camera.position.z = 10;
  t.camera.updateProjectionMatrix()
  t.hasChanged = false
  t.material = new THREE.MeshBasicMaterial( { color: 0xFFFF00 } )

  t.shapes = new THREE.Object3D()
  t.scene.add(t.shapes)

  t.setSize = function(width, height) {
    if(t.width == width && t.height == height) return
    t.width = width || 512
    t.height = height || 512
    t.camera.left = 0
    t.camera.right = t.width
    t.camera.top = t.height
    t.camera.bottom = 0
    t.camera.updateProjectionMatrix()
    t.buffer.setSize(t.width, t.height)
    t.updatePoints()
  }

  t.removeAll = function() {
    for(var i = 0; i < t.shapes.children.length; i++) {
        t.shapes.remove(t.shapes.children[i])
    }
  }

  t.updatePoints = function() {
    t.removeAll()
    if(t.points.length < 3) return
    var shape = new THREE.Shape()
    shape.moveTo((t.points[t.points.length-1].x)*t.width, (t.points[t.points.length-1].y)*t.height)
    for (var i = 0; i<t.points.length; i++) {
      shape.lineTo((t.points[i].x)*t.width, (t.points[i].y)*t.height)
    }
    var geometry = new THREE.ShapeGeometry(shape)

    t.mesh = new THREE.Mesh( geometry, t.material )
    t.shapes.add(t.mesh)
    t.hasChanged = true
  }
  t.updatePoints()
  return t
}

function makeInstallation(selector) {
  var t = {}
  t.selector = selector || "body"
  t.selected = 0
  t.selectedMaskPoint = 0
  t.maskMode = false
  t.paused = false
  t.showMarkers = true

  t.stats = new Stats();
  console.log(t.stats)
  //t.stats.setMode( 1 ); // 0: fps, 1: ms, 2: mb, 3+: custom
  //document.body.appendChild( t.stats.domElement );

  t.onResize = function() {
    t.width = window.innerWidth
    t.height = window.innerHeight
    t.mask.setSize(t.width, t.height)
    t.renderer.setSize(t.width, t.height)
    t.quad.setSize(t.width, t.height)
  }


  t.init = function() {
    t.width = window.innerWidth
    t.height = window.innerHeight
    t.quad = makeQuad() // Projection Mapping Quad
     //t.bl, t.br, t.tr, t.tl
    t.points = [
      t.quad.bl,
      t.quad.br,
      t.quad.tr,
      t.quad.tl,
    ]
    t.mask = makeMask(t.width,t.height) // Mask
    t.stage = makeStage(t.width,t.height) // Simulation
    t.stage.setSrc('../../assets/wgparty.mp4')
    t.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil:false })
    t.renderer.setClearColor( 0x000000, 1. )
    t.renderer.setSize(t.width, t.height)
    t.renderer.setPixelRatio(window.devicePixelRatio)

    t.container = document.querySelector(t.selector)
    t.container.appendChild(t.renderer.domElement)

    window.addEventListener('resize', t.onResize, false )
    window.addEventListener('keydown', t.onKeyDown, false )

    t.onResize()
    t.renderMask()
    //t.stage.init()
    t.quad.setTexture(t.stage.buffer.texture)
    t.quad.setMask(t.mask.buffer.texture)

    var conf = localStorage.getItem("conf")
    console.log(conf)
    if(conf) {
      var parsedConf = JSON.parse(conf)
      t.quad.bl.x = parsedConf.mapping.A.x
      t.quad.bl.y = parsedConf.mapping.A.y
      t.quad.br.x = parsedConf.mapping.B.x
      t.quad.br.y = parsedConf.mapping.B.y
      t.quad.tr.x = parsedConf.mapping.C.x
      t.quad.tr.y = parsedConf.mapping.C.y
      t.quad.tl.x = parsedConf.mapping.D.x
      t.quad.tl.y = parsedConf.mapping.D.y
      t.quad.updatePoints()
    }

    t.loop()
  }


  t.renderMask = function() {
      t.renderer.render(t.mask.scene, t.mask.camera, t.mask.buffer)
      t.maskBitmap = new Uint8Array(t.width*t.height*4)
      t.renderer.readRenderTargetPixels(t.mask.buffer, 0,0, t.width, t.height, t.maskBitmap)
      t.mask.hasChanged = false
  }

  t.render = function() {
    if (t.mask.hasChanged) t.renderMask()
    t.renderer.render(t.stage.scene, t.stage.camera, this.stage.buffer)
    t.renderer.render(t.quad.scene, t.quad.camera)
  }

  t.loop = function () {
    requestAnimationFrame(t.loop)
    t.render()
  }

  t.onKeyDown = function(e) {
    console.log(e)
    switch(e.key) {
      case " ":
        t.togglePause()
      break
      case "s":
        if(e.ctrlKey) {
          var data = {
            mapping: {
              A: {
                x: t.points[0].x,
                y: t.points[0].y
              },
              B: {
                x: t.points[1].x,
                y: t.points[1].y
              },
              C: {
                x: t.points[2].x,
                y: t.points[2].y
              },
              D: {
                x: t.points[3].x,
                y: t.points[3].y
              }
            }
          }
          localStorage.setItem('conf', JSON.stringify(data))
        }
      break
      case "d":
        if(e.ctrlKey) {
          localStorage.removeItem('conf')
          t.quad.bl.x = 0
          t.quad.bl.y = 0
          t.quad.br.x = 1
          t.quad.br.y = 0
          t.quad.tr.x = 1
          t.quad.tr.y = 1
          t.quad.tl.x = 0
          t.quad.tl.y = 1
          t.quad.updatePoints()
        }
      break
      case "m":
        t.toggleMaskMode()
      break;
      case "v":
        t.toggleUseVignette()
      break;
      case "t":
        t.toggleUseTestPattern()
      break;
      case "o":
        t.quad.material.uniforms.showMasked.value = t.quad.material.uniforms.showMasked.value?0:1
      break;
      case "i":
        t.insertPoint()
      break;
      case "I":
        t.insertPoint(true)
      break;
      case "r":
        t.removePoint()
      break;
      case "PageUp":
        t.prevPoint()
      break;
      case "PageDown":
        t.nextPoint()
      break;
      case "ArrowDown":
        t.decrementY((e.shiftKey)?.1:.001)
      break;
      case "ArrowUp":
        t.incrementY((e.shiftKey)?.1:.001)
      break;
      case "ArrowLeft":
        t.decrementX((e.shiftKey)?.1:.001)
      break;
      case "ArrowRight":
        t.incrementX((e.shiftKey)?.1:.001)
      break;
    }
    t.render()
  }

  t.getPoint = function() {
    if (t.maskMode) return {data: t.mask.points[t.selectedMaskPoint], update:t.mask.updatePoints}
    return {data: t.points[t.selected], update: t.quad.updatePoints}
  }

  t.toggleMaskMode = function() {
    t.maskMode = !t.maskMode
  }

  t.toggleUseTestPattern = function() {
    t.stage.useTestPattern = !t.stage.useTestPattern
    t.stage.updateTexture()
  }

  t.toggleUseVignette = function() {
    t.quad.useVignette = !t.quad.useVignette
    t.quad.updateVignette()
  }

  t.togglePause = function() {
    t.paused = !t.paused
  }

  t.insertPoint = function(prepend) {
    if (t.maskMode) {
      if(prepend) t.prevPoint()
      var pt = t.mask.points[t.selectedMaskPoint]
      t.nextPoint()
      var pt2 = t.mask.points[t.selectedMaskPoint]
      t.mask.points.splice(
        t.selectedMaskPoint,
        0,
        new THREE.Vector2().lerpVectors(pt, pt2, .5)
      )
      t.mask.updatePoints()
    }
  }

  t.removePoint = function() {
    if (t.maskMode && t.mask.points.length > 4) {
      t.mask.points.splice(t.selectedMaskPoint, 1)
      t.selectedMaskPoint = (t.selectedMaskPoint+t.mask.points.length)%t.mask.points.length
      t.mask.updatePoints()
    }
  }

  t.nextPoint = function() {
    if (t.maskMode) t.selectedMaskPoint = (t.selectedMaskPoint+1)%t.mask.points.length
    else t.selected = (t.selected+1)%t.mask.points.length
  }

  t.prevPoint = function() {
    if (t.maskMode) t.selectedMaskPoint = (t.selectedMaskPoint-1+t.mask.points.length)%t.mask.points.length
    else t.selected = (t.selected-1+t.points.length)%t.points.length
  }


  t.incrementX = function(val){
    var pt = t.getPoint()
    pt.data.x += val
    pt.update()
  }

  t.incrementY = function(val){
    var pt = t.getPoint()
    pt.data.y += val
    pt.update()
  }

  t.decrementX = function(val){
    var pt = t.getPoint()
    pt.data.x -= val
    pt.update()
  }

  t.decrementY = function(val){
    var pt = t.getPoint()
    pt.data.y -= val
    pt.update()
  }

  return t
}

var installation = makeInstallation("#screen")
installation.init()
