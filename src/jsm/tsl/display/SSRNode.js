import {
     NearestFilter,
     RenderTarget,
     Vector2,
     RendererUtils,
     QuadMesh,
     TempNode,
     NodeMaterial,
     NodeUpdateType,
} from "three/webgpu";
import {
     reference,
     viewZToPerspectiveDepth,
     logarithmicDepthToViewZ,
     getScreenPosition,
     getViewPosition,
     sqrt,
     mul,
     div,
     cross,
     float,
     Continue,
     Break,
     Loop,
     int,
     max,
     abs,
     sub,
     If,
     dot,
     reflect,
     normalize,
     screenCoordinate,
     nodeObject,
     Fn,
     passTexture,
     uv,
     uniform,
     perspectiveDepthToViewZ,
     orthographicDepthToViewZ,
     vec2,
     vec3,
     vec4,
} from "three/tsl";

const _quadMesh = /*@__PURE__*/ new QuadMesh();
const _size = /*@__PURE__*/ new Vector2();
let _rendererState;

/**
 * Post processing node for computing screen space reflections (SSR).
 *
 * Reference: {@link https://lettier.github.io/3d-game-shaders-for-beginners/screen-space-reflection.html}
 *
 * @augments TempNode
 * @three_import import { ssr } from 'three/addons/tsl/display/SSRNode.js';
 */
class SSRNode extends TempNode {
     static get type() {
          return "SSRNode";
     }

     /**
      * Constructs a new SSR node.
      *
      * @param {Node<vec4>} colorNode - The node that represents the beauty pass.
      * @param {Node<float>} depthNode - A node that represents the beauty pass's depth.
      * @param {Node<vec3>} normalNode - A node that represents the beauty pass's normals.
      * @param {Node<float>} metalnessNode - A node that represents the beauty pass's metalness.
      * @param {Camera} camera - The camera the scene is rendered with.
      */
     constructor(colorNode, depthNode, normalNode, metalnessNode, camera) {
          super("vec4");

          /**
           * The node that represents the beauty pass.
           *
           * @type {Node<vec4>}
           */
          this.colorNode = colorNode;

          /**
           * A node that represents the beauty pass's depth.
           *
           * @type {Node<float>}
           */
          this.depthNode = depthNode;

          /**
           * A node that represents the beauty pass's normals.
           *
           * @type {Node<vec3>}
           */
          this.normalNode = normalNode;

          /**
           * A node that represents the beauty pass's metalness.
           *
           * @type {Node<float>}
           */
          this.metalnessNode = metalnessNode;

          /**
           * The camera the scene is rendered with.
           *
           * @type {Camera}
           */
          this.camera = camera;

          /**
           * The resolution scale. By default SSR reflections
           * are computed in half resolutions. Setting the value
           * to `1` improves quality but also results in more
           * computational overhead.
           *
           * @type {number}
           * @default 0.5
           */
          this.resolutionScale = 0.5;

          /**
           * The `updateBeforeType` is set to `NodeUpdateType.FRAME` since the node renders
           * its effect once per frame in `updateBefore()`.
           *
           * @type {string}
           * @default 'frame'
           */
          this.updateBeforeType = NodeUpdateType.FRAME;

          /**
           * The render target the SSR is rendered into.
           *
           * @private
           * @type {RenderTarget}
           */
          this._ssrRenderTarget = new RenderTarget(1, 1, {
               depthBuffer: false,
               minFilter: NearestFilter,
               magFilter: NearestFilter,
          });
          this._ssrRenderTarget.texture.name = "SSRNode.SSR";

          /**
           * Controls how far a fragment can reflect.
           *
           *
           * @type {UniformNode<float>}
           */
          this.maxDistance = uniform(1);

          /**
           * Controls the cutoff between what counts as a possible reflection hit and what does not.
           *
           * @type {UniformNode<float>}
           */
          this.thickness = uniform(0.1);

          /**
           * Controls the transparency of the reflected colors.
           *
           * @type {UniformNode<float>}
           */
          this.opacity = uniform(1);

          /**
           * Represents the projection matrix of the scene's camera.
           *
           * @private
           * @type {UniformNode<mat4>}
           */
          this._cameraProjectionMatrix = uniform(camera.projectionMatrix);

          /**
           * Represents the inverse projection matrix of the scene's camera.
           *
           * @private
           * @type {UniformNode<mat4>}
           */
          this._cameraProjectionMatrixInverse = uniform(camera.projectionMatrixInverse);

          /**
           * Represents the near value of the scene's camera.
           *
           * @private
           * @type {ReferenceNode<float>}
           */
          this._cameraNear = reference("near", "float", camera);

          /**
           * Represents the far value of the scene's camera.
           *
           * @private
           * @type {ReferenceNode<float>}
           */
          this._cameraFar = reference("far", "float", camera);

          /**
           * Whether the scene's camera is perspective or orthographic.
           *
           * @private
           * @type {UniformNode<bool>}
           */
          this._isPerspectiveCamera = uniform(camera.isPerspectiveCamera ? 1 : 0);

          /**
           * The resolution of the pass.
           *
           * @private
           * @type {UniformNode<vec2>}
           */
          this._resolution = uniform(new Vector2());

          /**
           * This value is derived from the resolution and restricts
           * the maximum raymarching steps in the fragment shader.
           *
           * @private
           * @type {UniformNode<float>}
           */
          this._maxStep = uniform(0);

          /**
           * The material that is used to render the effect.
           *
           * @private
           * @type {NodeMaterial}
           */
          this._material = new NodeMaterial();
          this._material.name = "SSRNode.SSR";

          /**
           * The result of the effect is represented as a separate texture node.
           *
           * @private
           * @type {PassTextureNode}
           */
          this._textureNode = passTexture(this, this._ssrRenderTarget.texture);
     }

     /**
      * Returns the result of the effect as a texture node.
      *
      * @return {PassTextureNode} A texture node that represents the result of the effect.
      */
     getTextureNode() {
          return this._textureNode;
     }

     /**
      * Sets the size of the effect.
      *
      * @param {number} width - The width of the effect.
      * @param {number} height - The height of the effect.
      */
     setSize(width, height) {
          width = Math.round(this.resolutionScale * width);
          height = Math.round(this.resolutionScale * height);

          this._resolution.value.set(width, height);
          this._maxStep.value = Math.round(Math.sqrt(width * width + height * height));

          this._ssrRenderTarget.setSize(width, height);
     }

     /**
      * This method is used to render the effect once per frame.
      *
      * @param {NodeFrame} frame - The current node frame.
      */
     updateBefore(frame) {
          const { renderer } = frame;

          _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

          const size = renderer.getDrawingBufferSize(_size);

          _quadMesh.material = this._material;

          this.setSize(size.width, size.height);

          // clear

          renderer.setMRT(null);
          renderer.setClearColor(0x000000, 0);

          // ssr

          renderer.setRenderTarget(this._ssrRenderTarget);
          _quadMesh.render(renderer);

          // restore

          RendererUtils.restoreRendererState(renderer, _rendererState);
     }

     /**
      * This method is used to setup the effect's TSL code.
      *
      * @param {NodeBuilder} builder - The current node builder.
      * @return {PassTextureNode}
      */
     setup(builder) {
          const uvNode = uv();

          const pointToLineDistance = Fn(([point, linePointA, linePointB]) => {
               // https://mathworld.wolfram.com/Point-LineDistance3-Dimensional.html

               return cross(point.sub(linePointA), point.sub(linePointB))
                    .length()
                    .div(linePointB.sub(linePointA).length());
          });

          const pointPlaneDistance = Fn(([point, planePoint, planeNormal]) => {
               // https://mathworld.wolfram.com/Point-PlaneDistance.html
               // https://en.wikipedia.org/wiki/Plane_(geometry)
               // http://paulbourke.net/geometry/pointlineplane/

               const d = mul(planeNormal.x, planePoint.x)
                    .add(mul(planeNormal.y, planePoint.y))
                    .add(mul(planeNormal.z, planePoint.z))
                    .negate()
                    .toVar();

               const denominator = sqrt(
                    mul(planeNormal.x, planeNormal.x)
                         .add(mul(planeNormal.y, planeNormal.y))
                         .add(mul(planeNormal.z, planeNormal.z))
               ).toVar();
               const distance = div(
                    mul(planeNormal.x, point.x)
                         .add(mul(planeNormal.y, point.y))
                         .add(mul(planeNormal.z, point.z))
                         .add(d),
                    denominator
               );
               return distance;
          });

          const getViewZ = Fn(([depth]) => {
               let viewZNode;

               if (this.camera.isPerspectiveCamera) {
                    viewZNode = perspectiveDepthToViewZ(depth, this._cameraNear, this._cameraFar);
               } else {
                    viewZNode = orthographicDepthToViewZ(depth, this._cameraNear, this._cameraFar);
               }

               return viewZNode;
          });

          const sampleDepth = (uv) => {
               const depth = this.depthNode.sample(uv).r;

               if (builder.renderer.logarithmicDepthBuffer === true) {
                    const viewZ = logarithmicDepthToViewZ(depth, this._cameraNear, this._cameraFar);

                    return viewZToPerspectiveDepth(viewZ, this._cameraNear, this._cameraFar);
               }

               return depth;
          };

          const ssr = Fn(() => {
               const metalness = this.metalnessNode.sample(uvNode).r;

               // fragments with no metalness do not reflect their environment
               metalness.equal(0.0).discard();

               // compute some standard FX entities
               const depth = sampleDepth(uvNode).toVar();
               const viewPosition = getViewPosition(uvNode, depth, this._cameraProjectionMatrixInverse).toVar();
               const viewNormal = this.normalNode.rgb.normalize().toVar();

               // compute the direction from the position in view space to the camera
               const viewIncidentDir = (
                    this.camera.isPerspectiveCamera ? normalize(viewPosition) : vec3(0, 0, -1)
               ).toVar();

               // compute the direction in which the light is reflected on the surface
               const viewReflectDir = reflect(viewIncidentDir, viewNormal).toVar();

               // adapt maximum distance to the local geometry (see https://www.mathsisfun.com/algebra/vectors-dot-product.html)
               const maxReflectRayLen = this.maxDistance.div(dot(viewIncidentDir.negate(), viewNormal)).toVar();

               // compute the maximum point of the reflection ray in view space
               const d1viewPosition = viewPosition.add(viewReflectDir.mul(maxReflectRayLen)).toVar();

               // check if d1viewPosition lies behind the camera near plane
               If(
                    this._isPerspectiveCamera
                         .equal(float(1))
                         .and(d1viewPosition.z.greaterThan(this._cameraNear.negate())),
                    () => {
                         // if so, ensure d1viewPosition is clamped on the near plane.
                         // this prevents artifacts during the ray marching process
                         const t = sub(this._cameraNear.negate(), viewPosition.z).div(viewReflectDir.z);
                         d1viewPosition.assign(viewPosition.add(viewReflectDir.mul(t)));
                    }
               );

               // d0 and d1 are the start and maximum points of the reflection ray in screen space
               const d0 = screenCoordinate.xy.toVar();
               const d1 = getScreenPosition(d1viewPosition, this._cameraProjectionMatrix).mul(this._resolution).toVar();

               // below variables are used to control the raymarching process

               // total length of the ray
               const totalLen = d1.sub(d0).length().toVar();

               // offset in x and y direction
               const xLen = d1.x.sub(d0.x).toVar();
               const yLen = d1.y.sub(d0.y).toVar();

               // determine the larger delta
               // The larger difference will help to determine how much to travel in the X and Y direction each iteration and
               // how many iterations are needed to travel the entire ray
               const totalStep = max(abs(xLen), abs(yLen)).toVar();

               // step sizes in the x and y directions
               const xSpan = xLen.div(totalStep).toVar();
               const ySpan = yLen.div(totalStep).toVar();

               const output = vec4(0).toVar();

               // the actual ray marching loop
               // starting from d0, the code gradually travels along the ray and looks for an intersection with the geometry.
               // it does not exceed d1 (the maximum ray extend)
               Loop({ start: int(0), end: int(this._maxStep), type: "int", condition: "<" }, ({ i }) => {
                    // TODO: Remove this when Chrome is fixed, see https://issues.chromium.org/issues/372714384#comment14
                    If(metalness.equal(0), () => {
                         Break();
                    });

                    // stop if the maximum number of steps is reached for this specific ray
                    If(float(i).greaterThanEqual(totalStep), () => {
                         Break();
                    });

                    // advance on the ray by computing a new position in screen space
                    const xy = vec2(d0.x.add(xSpan.mul(float(i))), d0.y.add(ySpan.mul(float(i)))).toVar();

                    // stop processing if the new position lies outside of the screen
                    If(
                         xy.x
                              .lessThan(0)
                              .or(xy.x.greaterThan(this._resolution.x))
                              .or(xy.y.lessThan(0))
                              .or(xy.y.greaterThan(this._resolution.y)),
                         () => {
                              Break();
                         }
                    );

                    // compute new uv, depth, viewZ and viewPosition for the new location on the ray
                    const uvNode = xy.div(this._resolution);
                    const d = sampleDepth(uvNode).toVar();
                    const vZ = getViewZ(d).toVar();
                    const vP = getViewPosition(uvNode, d, this._cameraProjectionMatrixInverse).toVar();

                    const viewReflectRayZ = float(0).toVar();

                    // normalized distance between the current position xy and the starting point d0
                    const s = xy.sub(d0).length().div(totalLen);

                    // depending on the camera type, we now compute the z-coordinate of the reflected ray at the current step in view space
                    If(this._isPerspectiveCamera.equal(float(1)), () => {
                         const recipVPZ = float(1).div(viewPosition.z).toVar();
                         viewReflectRayZ.assign(
                              float(1).div(recipVPZ.add(s.mul(float(1).div(d1viewPosition.z).sub(recipVPZ))))
                         );
                    }).Else(() => {
                         viewReflectRayZ.assign(viewPosition.z.add(s.mul(d1viewPosition.z.sub(viewPosition.z))));
                    });

                    // if viewReflectRayZ is less or equal than the real z-coordinate at this place, it potentially intersects the geometry
                    If(viewReflectRayZ.lessThanEqual(vZ), () => {
                         // compute the distance of the new location to the ray in view space
                         // to clarify vP is the fragment's view position which is not an exact point on the ray
                         const away = pointToLineDistance(vP, viewPosition, d1viewPosition).toVar();

                         // compute the minimum thickness between the current fragment and its neighbor in the x-direction.
                         const xyNeighbor = vec2(xy.x.add(1), xy.y).toVar(); // move one pixel
                         const uvNeighbor = xyNeighbor.div(this._resolution);
                         const vPNeighbor = getViewPosition(uvNeighbor, d, this._cameraProjectionMatrixInverse).toVar();
                         const minThickness = vPNeighbor.x.sub(vP.x).toVar();
                         minThickness.mulAssign(3); // expand a bit to avoid errors

                         const tk = max(minThickness, this.thickness).toVar();

                         If(away.lessThanEqual(tk), () => {
                              // hit

                              const vN = this.normalNode.sample(uvNode).rgb.normalize().toVar();

                              If(dot(viewReflectDir, vN).greaterThanEqual(0), () => {
                                   // the reflected ray is pointing towards the same side as the fragment's normal (current ray position),
                                   // which means it wouldn't reflect off the surface. The loop continues to the next step for the next ray sample.
                                   Continue();
                              });

                              // this distance represents the depth of the intersection point between the reflected ray and the scene.
                              const distance = pointPlaneDistance(vP, viewPosition, viewNormal).toVar();

                              If(distance.greaterThan(this.maxDistance), () => {
                                   // Distance exceeding limit: The reflection is potentially too far away and
                                   // might not contribute significantly to the final color
                                   Break();
                              });

                              const op = this.opacity.mul(metalness).toVar();

                              // distance attenuation (the reflection should fade out the farther it is away from the surface)
                              const ratio = float(1).sub(distance.div(this.maxDistance)).toVar();
                              const attenuation = ratio.mul(ratio);
                              op.mulAssign(attenuation);

                              // fresnel (reflect more light on surfaces that are viewed at grazing angles)
                              const fresnelCoe = div(dot(viewIncidentDir, viewReflectDir).add(1), 2);
                              op.mulAssign(fresnelCoe);

                              // output
                              const reflectColor = this.colorNode.sample(uvNode);
                              output.assign(vec4(reflectColor.rgb, op));
                              Break();
                         });
                    });
               });

               return output;
          });

          this._material.fragmentNode = ssr().context(builder.getSharedContext());
          this._material.needsUpdate = true;

          //

          return this._textureNode;
     }

     /**
      * Frees internal resources. This method should be called
      * when the effect is no longer required.
      */
     dispose() {
          this._ssrRenderTarget.dispose();

          this._material.dispose();
     }
}

export default SSRNode;

/**
 * TSL function for creating screen space reflections (SSR).
 *
 * @tsl
 * @function
 * @param {Node<vec4>} colorNode - The node that represents the beauty pass.
 * @param {Node<float>} depthNode - A node that represents the beauty pass's depth.
 * @param {Node<vec3>} normalNode - A node that represents the beauty pass's normals.
 * @param {Node<float>} metalnessNode - A node that represents the beauty pass's metalness.
 * @param {Camera} camera - The camera the scene is rendered with.
 * @returns {SSRNode}
 */
export const ssr = (colorNode, depthNode, normalNode, metalnessNode, camera) =>
     nodeObject(
          new SSRNode(
               nodeObject(colorNode),
               nodeObject(depthNode),
               nodeObject(normalNode),
               nodeObject(metalnessNode),
               camera
          )
     );
