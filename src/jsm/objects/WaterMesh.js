import { Color, Mesh, Vector3, MeshLambertNodeMaterial } from "three/webgpu";

import {
     Fn,
     add,
     cameraPosition,
     div,
     normalize,
     positionWorld,
     sub,
     time,
     texture,
     vec2,
     vec3,
     max,
     dot,
     reflect,
     pow,
     length,
     float,
     uniform,
     reflector,
     mul,
     mix,
     diffuseColor,
} from "three/tsl";

/**
 * A basic flat, reflective water effect.
 *
 * Note that this class can only be used with {@link WebGPURenderer}. When using {@link WebGLRenderer}, use {@link Water}.
 *
 * References:
 *
 * - [Flat mirror for three.js]{@link https://github.com/Slayvin}
 * - [An implementation of water shader based on the flat mirror]{@link https://home.adelphi.edu/~stemkoski/}
 * - [Water shader explanations in WebGL]{@link http://29a.ch/slides/2012/webglwater/ }
 *
 * @augments Mesh
 * @three_import import { WaterMesh } from 'three/addons/objects/WaterMesh.js';
 */
class WaterMesh extends Mesh {
     /**
      * Constructs a new water mesh.
      *
      * @param {BufferGeometry} geometry - The water mesh's geometry.
      * @param {WaterMesh~Options} [options] - The configuration options.
      */
     constructor(geometry, options) {
          const material = new MeshLambertNodeMaterial();

          super(geometry, material);

          /**
           * This flag can be used for type testing.
           *
           * @default true
           * @type {boolean}
           * @readonly
           */
          this.isWaterMesh = true;

          /**
           * The effect's resolution scale.
           *
           * @default 0.5
           * @type {number}
           */
          this.resolution = options.resolution !== undefined ? options.resolution : 0.5;

          // Uniforms

          /**
           * The water's normal map.
           *
           * @type {TextureNode}
           */
          this.waterNormals = texture(options.waterNormals);

          /**
           * The alpha value.
           *
           * @default 1
           * @type {UniformNode<float>}
           */
          this.alpha = uniform(options.alpha !== undefined ? options.alpha : 1.0);

          /**
           * The size value.
           *
           * @default 1
           * @type {UniformNode<float>}
           */
          this.size = uniform(options.size !== undefined ? options.size : 1.0);

          /**
           * The sun color.
           *
           * @default 0xffffff
           * @type {UniformNode<color>}
           */
          this.sunColor = uniform(new Color(options.sunColor !== undefined ? options.sunColor : 0xffffff));

          /**
           * The sun direction.
           *
           * @default (0.70707,0.70707,0.0)
           * @type {UniformNode<vec3>}
           */
          this.sunDirection = uniform(
               options.sunDirection !== undefined ? options.sunDirection : new Vector3(0.70707, 0.70707, 0.0)
          );

          /**
           * The water color.
           *
           * @default 0x7f7f7f
           * @type {UniformNode<color>}
           */
          this.waterColor = uniform(new Color(options.waterColor !== undefined ? options.waterColor : 0x7f7f7f));

          /**
           * The distortion scale.
           *
           * @default 20
           * @type {UniformNode<float>}
           */
          this.distortionScale = uniform(options.distortionScale !== undefined ? options.distortionScale : 20.0);

          // TSL

          const getNoise = Fn(([uv]) => {
               const offset = time;

               const uv0 = add(div(uv, 103), vec2(div(offset, 17), div(offset, 29))).toVar();
               const uv1 = div(uv, 107)
                    .sub(vec2(div(offset, -19), div(offset, 31)))
                    .toVar();
               const uv2 = add(div(uv, vec2(8907.0, 9803.0)), vec2(div(offset, 101), div(offset, 97))).toVar();
               const uv3 = sub(div(uv, vec2(1091.0, 1027.0)), vec2(div(offset, 109), div(offset, -113))).toVar();

               const sample0 = this.waterNormals.sample(uv0);
               const sample1 = this.waterNormals.sample(uv1);
               const sample2 = this.waterNormals.sample(uv2);
               const sample3 = this.waterNormals.sample(uv3);

               const noise = sample0.add(sample1).add(sample2).add(sample3);

               return noise.mul(0.5).sub(1);
          });

          const noise = getNoise(positionWorld.xz.mul(this.size));
          const surfaceNormal = normalize(noise.xzy.mul(1.5, 1.0, 1.5));

          const worldToEye = cameraPosition.sub(positionWorld);
          const eyeDirection = normalize(worldToEye);

          const reflection = normalize(reflect(this.sunDirection.negate(), surfaceNormal));
          const direction = max(0.0, dot(eyeDirection, reflection));
          const specularLight = pow(direction, 100).mul(this.sunColor).mul(2.0);
          const diffuseLight = max(dot(this.sunDirection, surfaceNormal), 0.0).mul(this.sunColor).mul(0.5);

          const distance = length(worldToEye);

          const distortion = surfaceNormal.xz.mul(float(0.001).add(float(1.0).div(distance))).mul(this.distortionScale);

          // Material

          material.transparent = true;

          material.opacityNode = this.alpha;

          material.receivedShadowPositionNode = positionWorld.add(distortion);

          material.setupOutgoingLight = () => diffuseColor.rgb; // backwards compatibility

          material.colorNode = Fn(() => {
               const mirrorSampler = reflector();
               mirrorSampler.uvNode = mirrorSampler.uvNode.add(distortion);
               mirrorSampler.resolution = this.resolution;

               this.add(mirrorSampler.target);

               const theta = max(dot(eyeDirection, surfaceNormal), 0.0);
               const rf0 = float(0.3);
               const reflectance = mul(pow(float(1.0).sub(theta), 5.0), float(1.0).sub(rf0)).add(rf0);
               const scatter = max(0.0, dot(surfaceNormal, eyeDirection)).mul(this.waterColor);
               const albedo = mix(
                    this.sunColor.mul(diffuseLight).mul(0.3).add(scatter),
                    mirrorSampler.rgb.mul(specularLight).add(mirrorSampler.rgb.mul(0.9)).add(vec3(0.1)),
                    reflectance
               );

               return albedo;
          })();
     }
}

/**
 * Constructor options of `WaterMesh`.
 *
 * @typedef {Object} WaterMesh~Options
 * @property {number} [resolution=0.5] - The resolution scale. Default is `0.5`
 * @property {Texture | null} [waterNormals=null] - The water's normal map. Default is `null`
 * @property {number} [alpha=1] - The alpha value. Default is `1`
 * @property {number} [size=1] - The size value. Default is `1`
 * @property {number | Color | string} [sunColor=0xffffff] - The sun color. Default is `0xffffff`
 * @property {Vector3} [sunDirection=(0.70707,0.70707,0.0)] - The sun direction. Default is `(0.70707,0.70707,0.0)`
 * @property {number | Color | string} [waterColor=0x7F7F7F] - The water color. Default is `0x7F7F7F`
 * @property {number} [distortionScale=20] - The distortion scale. Default is `20`
 */

export { WaterMesh };
