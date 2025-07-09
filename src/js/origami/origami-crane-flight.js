// Import Three.js modules
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// Global variables
let scene, camera, renderer, controls;
let pathsData = []; // Array to store multiple path data {curve, crane}
let animationActive = false;
let animationSpeed = 0.2; // Default to 0.2x speed
let animationTime = 0;
let numberOfCranes = 25; // Default number of cranes
let programRunning = false; // Track if the program is running

// Wing flapping animation variables
let wingFlapEnabled = false;
let wingFlapSpeed = 7.5; // Default to 7.5x speed
let wingFlapTime = 0;

// Crane display settings
let cranesColored = true; // Toggle between colored and white cranes
let craneScale = 2.0; // Default crane scale

// Crane model variables
let originalCraneObject = null; // Store the original loaded crane for cloning

// Wing flapping animation sets
const WING_FLAP_ANGLE = 0.5; // Maximum rotation angle in radians

// Color palette for multiple paths
const pathColors = [
     0xe91e63, // Pink
     0x2196f3, // Blue
     0x4caf50, // Green
     0xff9800, // Orange
     0x9c27b0, // Purple
     0x00bcd4, // Cyan
     0xff5722, // Deep Orange
     0x8bc34a, // Light Green
     0x3f51b5, // Indigo
     0xffc107, // Amber
];

// Rotation constraints and initial state tracking
const ROTATION_CONSTRAINTS = {
     maxYaw: Math.PI / 2, // 90 degrees in radians (relative to past state)
     maxPitch: Math.PI / 4, // 45 degrees in radians (relative to past state)
     maxRoll: Math.PI / 12, // 15 degrees in radians (relative to past state)
     maxRollFromInitial: Math.PI / 4, // 45 degrees in radians (relative to initial state)
     pastStateDelayFrames: 3, // Approximately 0.05 seconds at 60 FPS
};

// Rotation smoothing parameters
const ROTATION_SMOOTHING = {
     smoothingFactor: 0.05, // Lower value = smoother but slower response
     enabled: true, // Toggle for rotation smoothing
     minAngleThreshold: 0.01, // Minimum angle change threshold in radians
};

// Crane class to encapsulate individual crane data and behavior
class CraneInstance {
     constructor(id, pathData) {
          this.id = id;
          this.pathData = pathData; // Reference to the path this crane follows
          this.craneObject = null;
          this.faces = [];
          this.edges = [];
          this.meshGroups = [];
          this.objectCenter = new THREE.Vector3(); // Center of this crane object
          this.initialScale = null; // Store the initial scale for relative scaling

          // Direction tracking
          this.face2Centroid = null;
          this.currentDirection = new THREE.Vector3(1, 0, 0);
          this.directionMatrixUniforms = []; // Store references to direction matrix uniforms

          // Rotation state tracking
          this.initialQuaternion = null; // Store the initial rotation quaternion
          this.pastStates = []; // Array to store past rotation states
          this.isVisible = false; // Track visibility state for constraint application
          this.frameCount = 0; // Track animation frames for this path
          this.smoothedQuaternion = null; // Current smoothed rotation quaternion
          this.targetQuaternion = null; // Target rotation quaternion for smoothing

          // Animation sets for this crane instance
          this.animationSet1 = {
               selectedFaceIndices: [23, 24, 25, 26, 27, 28, 29, 86, 87, 102, 103],
               hingeEdgeIndex: 80,
               hingeEdgeData: null,
               isAnimationActive: false,
               animationUniforms: null,
          };

          this.animationSet2 = {
               selectedFaceIndices: [8, 10, 9, 11, 12, 13, 14, 70, 71, 88, 89],
               hingeEdgeIndex: 35,
               hingeEdgeData: null,
               isAnimationActive: false,
               animationUniforms: null,
          };

          this.initializeAnimationUniforms();
     }

     initializeAnimationUniforms() {
          this.animationSet1.animationUniforms = {
               time: { value: 0.0 },
               animationPhase: { value: 0.0 },
               rotationAngle: { value: WING_FLAP_ANGLE },
               isAnimating: { value: false },
          };

          this.animationSet2.animationUniforms = {
               time: { value: 0.0 },
               animationPhase: { value: 0.0 },
               rotationAngle: { value: WING_FLAP_ANGLE },
               isAnimating: { value: false },
          };
     }

     startWingFlap() {
          this.animationSet1.isAnimationActive = true;
          this.animationSet2.isAnimationActive = true;

          if (this.animationSet1.animationUniforms) {
               this.animationSet1.animationUniforms.isAnimating.value = true;
          }
          if (this.animationSet2.animationUniforms) {
               this.animationSet2.animationUniforms.isAnimating.value = true;
          }

          console.log(`Crane ${this.id} wing flap animation started`);
     }

     stopWingFlap() {
          this.animationSet1.isAnimationActive = false;
          this.animationSet2.isAnimationActive = false;

          if (this.animationSet1.animationUniforms) {
               this.animationSet1.animationUniforms.isAnimating.value = false;
          }
          if (this.animationSet2.animationUniforms) {
               this.animationSet2.animationUniforms.isAnimating.value = false;
          }

          console.log(`Crane ${this.id} wing flap animation stopped`);
     }

     calculateMovementDirectionForPath(time, speed) {
          // Calculate movement direction for current movement direction
          if (!this.pathData.curvePoints) {
               return new THREE.Vector3(1, 0, 0);
          }

          const curvePoints = this.pathData.curvePoints;
          const progress = (time * speed) % (curvePoints.length - 1);
          const index = Math.floor(progress);

          // For initial movement vector, use point 10% of the distance to ending point
          if (this.frameCount < 5) {
               // Use this approach for first few frames
               const tenPercentIndex = Math.floor(curvePoints.length * 0.1);
               if (tenPercentIndex > 0 && tenPercentIndex < curvePoints.length) {
                    const startPoint = curvePoints[0];
                    const tenPercentPoint = curvePoints[tenPercentIndex];
                    return new THREE.Vector3().subVectors(tenPercentPoint, startPoint).normalize();
               }
          }

          // Normal operation: use derivative approach
          if (index < curvePoints.length - 1) {
               const currentPoint = curvePoints[index];
               const nextPoint = curvePoints[index + 1];
               return new THREE.Vector3().subVectors(nextPoint, currentPoint).normalize();
          }

          return new THREE.Vector3(1, 0, 0);
     }

     calculateRotationMatrix() {
          // Create rotation matrix to align the tracking vector with movement direction in full 3D space
          if (!this.face2Centroid || !this.objectCenter) {
               return new THREE.Matrix4();
          }

          // Calculate the full 3D tracking vector (object center to face 2)
          const objectToFace2 = new THREE.Vector3().subVectors(this.face2Centroid, this.objectCenter);
          const trackingVector = objectToFace2.clone().normalize();

          // Use the full 3D movement direction (including Y-axis changes)
          const movementDirection = this.currentDirection.clone().normalize();

          // Calculate rotation needed to align the full 3D tracking vector with the full 3D movement direction
          const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(trackingVector, movementDirection);

          // Apply rotation constraints
          const constrainedQuaternion = this.applyRotationConstraints(targetQuaternion);

          const rotationMatrix = new THREE.Matrix4();
          rotationMatrix.makeRotationFromQuaternion(constrainedQuaternion);

          return rotationMatrix;
     }

     applyRotationConstraints(targetQuaternion) {
          // Initialize initial rotation state if not set
          if (!this.initialQuaternion) {
               this.initialQuaternion = new THREE.Quaternion(); // Identity quaternion (no rotation)
          }

          // Store current state in past states array
          this.pastStates.push({
               quaternion: this.craneObject ? this.craneObject.quaternion.clone() : new THREE.Quaternion(),
               frameCount: this.frameCount,
          });

          // Keep only the necessary past states (for 0.05 seconds)
          while (this.pastStates.length > ROTATION_CONSTRAINTS.pastStateDelayFrames + 1) {
               this.pastStates.shift();
          }

          // Get past state (0.05 seconds ago)
          const pastState =
               this.pastStates.length > ROTATION_CONSTRAINTS.pastStateDelayFrames
                    ? this.pastStates[this.pastStates.length - ROTATION_CONSTRAINTS.pastStateDelayFrames - 1]
                    : this.pastStates[0] || { quaternion: this.initialQuaternion.clone() };

          // Check if crane is visible (implement constraints)
          const implementConstraints = this.isVisible;

          if (!implementConstraints) {
               // Before visible: only apply roll constraint relative to initial state
               const relativeToInitial = targetQuaternion.clone().premultiply(this.initialQuaternion.clone().invert());
               const eulerFromInitial = new THREE.Euler().setFromQuaternion(relativeToInitial, "YXZ");

               // Only constrain roll
               let roll = eulerFromInitial.z;
               roll = Math.max(
                    -ROTATION_CONSTRAINTS.maxRollFromInitial,
                    Math.min(ROTATION_CONSTRAINTS.maxRollFromInitial, roll)
               );

               const constrainedEuler = new THREE.Euler(eulerFromInitial.x, eulerFromInitial.y, roll, "YXZ");
               const constrainedRelative = new THREE.Quaternion().setFromEuler(constrainedEuler);
               return this.initialQuaternion.clone().multiply(constrainedRelative);
          }

          // Visible: apply full constraints (simplified version for integration)
          return targetQuaternion;
     }

     applySmoothedRotation() {
          // Calculate the target rotation matrix
          const rotationMatrix = this.calculateRotationMatrix();
          this.targetQuaternion.setFromRotationMatrix(rotationMatrix);

          if (!ROTATION_SMOOTHING.enabled) {
               // If smoothing is disabled, apply rotation directly
               this.craneObject.quaternion.copy(this.targetQuaternion);
               this.smoothedQuaternion.copy(this.targetQuaternion);
               return;
          }

          // For the first few frames, initialize smoothed quaternion
          if (this.frameCount <= 1 || !this.smoothedQuaternion) {
               this.smoothedQuaternion.copy(this.targetQuaternion);
               this.craneObject.quaternion.copy(this.targetQuaternion);
               return;
          }

          // Calculate the angle difference between current and target rotation
          const angleDifference = this.smoothedQuaternion.angleTo(this.targetQuaternion);

          // If the angle difference is very small, don't apply smoothing to avoid jitter
          if (angleDifference < ROTATION_SMOOTHING.minAngleThreshold) {
               return;
          }

          // Apply spherical linear interpolation (SLERP) for smooth rotation
          this.smoothedQuaternion.slerp(this.targetQuaternion, ROTATION_SMOOTHING.smoothingFactor);

          // Apply the smoothed rotation to the crane
          this.craneObject.quaternion.copy(this.smoothedQuaternion);
     }

     updateAnimation() {
          const deltaTime = 0.016; // Approximately 60 FPS

          // Increment frame counter
          this.frameCount++;

          // Update wing flap animations
          [this.animationSet1, this.animationSet2].forEach((animationSet) => {
               if (animationSet.animationUniforms) {
                    if (animationSet.animationUniforms.isAnimating.value) {
                         animationSet.animationUniforms.time.value += deltaTime * wingFlapSpeed;
                         animationSet.animationUniforms.animationPhase.value = Math.sin(
                              animationSet.animationUniforms.time.value * 2.0
                         );
                    } else {
                         animationSet.animationUniforms.time.value = 0.0;
                    }
               }
          });

          // Auto-start wing flapping when crane becomes visible
          if (this.isVisible && wingFlapEnabled && !this.animationSet1.isAnimationActive) {
               this.startWingFlap();
          }

          // Stop wing flapping when globally disabled
          if (!wingFlapEnabled && this.animationSet1.isAnimationActive) {
               this.stopWingFlap();
          }
     }
}

function initCraneAnimation() {
     const container = document.getElementById("container");
     if (!container) {
          console.error("Container element not found");
          return;
     }

     // Create scene
     scene = new THREE.Scene();
     scene.background = new THREE.Color(0x87ceeb); // Sky blue background

     // Create camera
     camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
     camera.position.set(0, 10, 50); // Set Y=10, adjusted Z distance to view Y range -30 to 40

     // Create renderer
     renderer = new THREE.WebGLRenderer({ antialias: true });
     renderer.setSize(window.innerWidth, window.innerHeight);
     renderer.shadowMap.enabled = true;
     renderer.shadowMap.type = THREE.PCFSoftShadowMap;
     renderer.setClearColor(0x87ceeb, 1);
     container.appendChild(renderer.domElement);

     // Add orbit controls
     controls = new OrbitControls(camera, renderer.domElement);
     controls.enableDamping = true;
     controls.dampingFactor = 0.05;
     controls.screenSpacePanning = false;
     controls.minDistance = 3;
     controls.maxDistance = 100; // Increased to accommodate new camera position
     controls.maxPolarAngle = Math.PI / 1.5;

     // Add lighting
     setupLighting();

     // Load the crane model
     loadCraneModel();

     // Setup controls
     setupControls();

     // Handle window resize
     window.addEventListener("resize", onWindowResize, false);

     // Hide loading screen
     const loadingDiv = document.getElementById("loading");
     if (loadingDiv) loadingDiv.classList.add("hidden");

     // Start the animation loop
     animate();

     // Initialize UI state
     updateUI();

     console.log("Crane Animation initialized successfully!");
}

function setupLighting() {
     // Ambient light for overall illumination
     const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
     scene.add(ambientLight);

     // Main directional light (sun-like)
     const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
     directionalLight.position.set(10, 15, 5);
     directionalLight.castShadow = true;
     directionalLight.shadow.mapSize.width = 2048;
     directionalLight.shadow.mapSize.height = 2048;
     directionalLight.shadow.camera.near = 0.5;
     directionalLight.shadow.camera.far = 50;
     directionalLight.shadow.camera.left = -20;
     directionalLight.shadow.camera.right = 20;
     directionalLight.shadow.camera.top = 20;
     directionalLight.shadow.camera.bottom = -20;
     scene.add(directionalLight);

     // Fill light from the opposite side
     const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.4);
     fillLight.position.set(-5, 3, -5);
     scene.add(fillLight);
}

function loadCraneModel() {
     const loader = new OBJLoader();

     loader.load(
          "assets/crane-3D.obj",
          function (object) {
               originalCraneObject = object;
               console.log("Crane model loaded successfully");
          },
          function (progress) {
               console.log("Loading crane model progress:", progress);
          },
          function (error) {
               console.error("Error loading crane model:", error);
          }
     );
}

function generateMultiplePaths() {
     // Clear existing paths
     clearExistingPaths();

     // Set planes at x=15 and x=85 (15% and 85% of viewing window which goes from 0-100)
     const startX = -35; // Adjusted for the default viewing window
     const endX = 35;

     // Generate the specified number of paths
     for (let i = 0; i < numberOfCranes; i++) {
          const pathData = generateSinglePath(startX, endX, i);
          pathsData.push(pathData);
     }

     console.log(`Generated ${numberOfCranes} paths between x=${startX.toFixed(2)} and x=${endX.toFixed(2)}`);
}

function generateSinglePath(startX, endX, pathIndex) {
     // Generate random start and end points on the planes
     const startY = Math.random() * 45 - 15; // Random height between -15 and 30
     const startZ = Math.random() * 40 - 20; // Random Z between -20 and 20
     const endY = Math.random() * 45 - 15;
     const endZ = Math.random() * 40 - 20;

     const startPoint = new THREE.Vector3(startX, startY, startZ);
     const endPoint = new THREE.Vector3(endX, endY, endZ);

     // Generate random sinusoidal parameters for this path
     const pathParams = {
          frequency: 1 + Math.random() * 4, // 1-5 cycles
          amplitude: 0.5 + Math.random() * 2, // 0.5-2.5 amplitude
          phase: Math.random() * Math.PI * 2, // Random phase
          verticalOffset: Math.random() * 2 - 1, // -1 to 1 vertical offset
     };

     // Create curve points
     const curvePoints = [];
     const numPoints = 100;

     for (let i = 0; i <= numPoints; i++) {
          const t = i / numPoints;

          // Linear interpolation between start and end points
          const basePoint = new THREE.Vector3().lerpVectors(startPoint, endPoint, t);

          // Calculate perpendicular direction for sinusoidal displacement
          const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const perpendicular = new THREE.Vector3().crossVectors(direction, up).normalize();

          // Add sinusoidal displacement
          const sineValue = Math.sin(t * Math.PI * pathParams.frequency + pathParams.phase);
          const displacement = perpendicular.clone().multiplyScalar(sineValue * pathParams.amplitude);

          // Add vertical component
          const verticalDisplacement = new THREE.Vector3(0, sineValue * pathParams.verticalOffset, 0);

          const curvePoint = basePoint.clone().add(displacement).add(verticalDisplacement);
          curvePoints.push(curvePoint);
     }

     const curveColor = pathColors[pathIndex % pathColors.length];

     return {
          curvePoints: curvePoints,
          startPoint: startPoint,
          endPoint: endPoint,
          pathParams: pathParams,
          color: curveColor,
          crane: null, // Will be created when animation starts
     };
}

function clearExistingPaths() {
     // Remove existing path data
     pathsData.forEach((pathData) => {
          if (pathData.crane) {
               // Remove crane object
               scene.remove(pathData.crane.craneObject);
          }
     });
     pathsData = [];

     // Reset animation state
     animationTime = 0;
}

function createAnimatingCranes() {
     if (!originalCraneObject) {
          console.warn("Crane model not loaded yet");
          return;
     }

     // Create a crane for each path
     pathsData.forEach((pathData, index) => {
          if (pathData.crane) {
               // Remove existing crane
               scene.remove(pathData.crane.craneObject);
          }

          // Create new crane instance
          const crane = new CraneInstance(index, pathData);
          pathData.crane = crane;

          // Clone the crane model for animation
          crane.craneObject = originalCraneObject.clone();
          crane.craneObject.visible = true;

          // Position at the start point
          crane.craneObject.position.copy(pathData.startPoint);

          // Initialize the rotation state for constraints
          crane.initialQuaternion = new THREE.Quaternion(); // Identity quaternion (no rotation)
          crane.pastStates = []; // Initialize past states array
          crane.isVisible = false; // Start invisible
          crane.frameCount = 0; // Initialize frame counter
          crane.smoothedQuaternion = new THREE.Quaternion(); // Initialize smoothed quaternion
          crane.targetQuaternion = new THREE.Quaternion(); // Initialize target quaternion

          // Process the crane (extract faces, edges, apply shaders)
          processCraneInstance(crane, pathData.color);

          scene.add(crane.craneObject);
     });

     console.log(`Created ${pathsData.length} animating cranes`);
}

function processCraneInstance(crane, craneColor) {
     const object = crane.craneObject;

     // Clear arrays for this instance
     crane.meshGroups = [];
     crane.edges = [];
     crane.faces = [];
     crane.directionMatrixUniforms = [];

     // Process each mesh in the crane object
     object.traverse(function (child) {
          if (child.isMesh) {
               // Store original geometry and material
               const originalGeometry = child.geometry;
               const originalMaterial = child.material;

               // Ensure geometry has indices
               if (!originalGeometry.index) {
                    originalGeometry.setIndex(
                         Array.from({ length: originalGeometry.attributes.position.count }, (_, i) => i)
                    );
               }

               // Create group for mesh and wireframe
               const meshGroup = new THREE.Group();

               // Clone mesh for animation
               const solidMesh = new THREE.Mesh(originalGeometry.clone(), originalMaterial.clone());

               // Create wireframe
               const wireframeMesh = createWireframe(originalGeometry, crane);

               // Add to group
               meshGroup.add(solidMesh);
               meshGroup.add(wireframeMesh);

               // Store references
               meshGroup.userData = {
                    solidMesh: solidMesh,
                    wireframeMesh: wireframeMesh,
                    originalGeometry: originalGeometry.clone(),
               };

               // Replace original mesh
               child.parent.add(meshGroup);
               child.parent.remove(child);

               crane.meshGroups.push(meshGroup);
          }
     });

     // Center and scale the model
     const box = new THREE.Box3().setFromObject(object);
     const center = box.getCenter(new THREE.Vector3());
     const size = box.getSize(new THREE.Vector3());
     const maxDim = Math.max(size.x, size.y, size.z);
     const baseScale = 1.5 / maxDim; // Base scale without user scale
     const scale = baseScale * craneScale; // Apply user scale

     object.scale.setScalar(scale);
     object.position.sub(center.multiplyScalar(scale));

     // Store the initial scale for relative scaling
     crane.initialScale = baseScale;

     // Update matrices
     object.updateMatrixWorld(true);

     // Calculate the object center after transformation
     const finalBox = new THREE.Box3().setFromObject(object);
     crane.objectCenter.copy(finalBox.getCenter(new THREE.Vector3()));

     // Extract faces
     crane.meshGroups.forEach((group) => {
          const solidMesh = group.userData.solidMesh;
          extractFaces(solidMesh, crane);
     });

     // Set up animation
     setupHingeEdgeData(crane);

     // Calculate face centroids for the direction vector
     if (crane.faces.length > 2) {
          crane.face2Centroid = calculateFaceCentroid(2, crane);
          console.log(`Crane ${crane.id}: Face 2 centroid calculated`);
     }

     // Apply wing flapping shaders and color tint to the crane
     applyWingFlappingToCrane(crane, craneColor);
}

function createWireframe(geometry, crane) {
     const position = geometry.attributes.position;
     const edgeIndices = [];
     const edgeSet = new Set();
     const meshEdges = [];

     // Extract edges from faces
     for (let i = 0; i < position.count; i += 3) {
          const a = i;
          const b = i + 1;
          const c = i + 2;

          const triangleEdges = [
               [a, b],
               [b, c],
               [c, a],
          ];

          triangleEdges.forEach(([v1, v2]) => {
               const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
               if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edgeIndices.push(v1, v2);

                    meshEdges.push({
                         index: meshEdges.length,
                         vertices: [v1, v2],
                         v1: new THREE.Vector3().fromBufferAttribute(position, v1),
                         v2: new THREE.Vector3().fromBufferAttribute(position, v2),
                    });
               }
          });
     }

     // Add edges to crane instance
     crane.edges.push(...meshEdges);

     // Create wireframe geometry
     const wireframeGeometry = new THREE.BufferGeometry();
     const originalPositions = geometry.attributes.position.array;
     wireframeGeometry.setAttribute("position", new THREE.BufferAttribute(originalPositions.slice(), 3));
     wireframeGeometry.setIndex(edgeIndices);

     const wireframeMaterial = new THREE.LineBasicMaterial({
          color: 0x000000,
          linewidth: 2,
     });

     return new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
}

function extractFaces(mesh, crane) {
     const geometry = mesh.geometry;
     const position = geometry.attributes.position;

     for (let i = 0; i < position.count; i += 3) {
          const face = {
               index: crane.faces.length,
               vertices: [i, i + 1, i + 2],
               mesh: mesh,
               a: i,
               b: i + 1,
               c: i + 2,
          };
          crane.faces.push(face);
     }
}

function calculateFaceCentroid(faceIndex, crane) {
     if (faceIndex >= crane.faces.length) {
          console.warn(`Face ${faceIndex} does not exist. Total faces: ${crane.faces.length}`);
          return new THREE.Vector3();
     }

     const face = crane.faces[faceIndex];
     const geometry = face.mesh.geometry;
     const position = geometry.attributes.position;

     const centroid = new THREE.Vector3();
     const v1 = new THREE.Vector3().fromBufferAttribute(position, face.a);
     const v2 = new THREE.Vector3().fromBufferAttribute(position, face.b);
     const v3 = new THREE.Vector3().fromBufferAttribute(position, face.c);

     centroid.add(v1).add(v2).add(v3).divideScalar(3);

     // Apply the mesh's world transform
     face.mesh.localToWorld(centroid);

     return centroid;
}

function setupHingeEdgeData(crane) {
     if (crane.edges.length > crane.animationSet1.hingeEdgeIndex) {
          crane.animationSet1.hingeEdgeData = crane.edges[crane.animationSet1.hingeEdgeIndex];
          console.log(
               `Set up hinge edge data for crane ${crane.id} left wing: edge ${crane.animationSet1.hingeEdgeIndex}`
          );
     } else {
          console.warn(
               `Hinge edge index ${crane.animationSet1.hingeEdgeIndex} for crane ${crane.id} left wing is out of range. Total edges: ${crane.edges.length}`
          );
     }

     if (crane.edges.length > crane.animationSet2.hingeEdgeIndex) {
          crane.animationSet2.hingeEdgeData = crane.edges[crane.animationSet2.hingeEdgeIndex];
          console.log(
               `Set up hinge edge data for crane ${crane.id} right wing: edge ${crane.animationSet2.hingeEdgeIndex}`
          );
     } else {
          console.warn(
               `Hinge edge index ${crane.animationSet2.hingeEdgeIndex} for crane ${crane.id} right wing is out of range. Total edges: ${crane.edges.length}`
          );
     }
}

function getVerticesFromSelectedFaces(faceIndices, crane) {
     const selectedVertices = new Set();

     faceIndices.forEach((faceIndex) => {
          if (faceIndex < crane.faces.length) {
               const face = crane.faces[faceIndex];
               face.vertices.forEach((vertexIndex) => {
                    selectedVertices.add(vertexIndex);
               });
          }
     });

     return Array.from(selectedVertices);
}

function calculateHingeAnimation(vertices, hingeEdge) {
     if (!hingeEdge) return null;

     const hingeAxis = new THREE.Vector3().subVectors(hingeEdge.v2, hingeEdge.v1).normalize();

     const hingePoint = hingeEdge.v1.clone();

     return {
          axis: hingeAxis,
          point: hingePoint,
          vertices: vertices,
     };
}

function applyWingFlappingToCrane(crane, craneColor) {
     // Get vertex data for both wing animation sets
     const set1Data =
          crane.animationSet1.selectedFaceIndices.length > 0
               ? {
                      selectedVertices: getVerticesFromSelectedFaces(crane.animationSet1.selectedFaceIndices, crane),
                      hingeData: calculateHingeAnimation([], crane.animationSet1.hingeEdgeData),
                 }
               : null;

     const set2Data =
          crane.animationSet2.selectedFaceIndices.length > 0
               ? {
                      selectedVertices: getVerticesFromSelectedFaces(crane.animationSet2.selectedFaceIndices, crane),
                      hingeData: calculateHingeAnimation([], crane.animationSet2.hingeEdgeData),
                 }
               : null;

     crane.meshGroups.forEach((group) => {
          const solidMesh = group.userData.solidMesh;
          const wireframeMesh = group.userData.wireframeMesh;
          const solidGeometry = solidMesh.geometry;
          const wireframeGeometry = wireframeMesh.geometry;

          // Create vertex selection arrays for both wing sets
          const solidVertexSelection1 = new Float32Array(solidGeometry.attributes.position.count);
          const wireframeVertexSelection1 = new Float32Array(wireframeGeometry.attributes.position.count);
          const solidVertexSelection2 = new Float32Array(solidGeometry.attributes.position.count);
          const wireframeVertexSelection2 = new Float32Array(wireframeGeometry.attributes.position.count);

          solidVertexSelection1.fill(0.0);
          wireframeVertexSelection1.fill(0.0);
          solidVertexSelection2.fill(0.0);
          wireframeVertexSelection2.fill(0.0);

          // Mark vertices for left wing (Set 1)
          if (set1Data) {
               set1Data.selectedVertices.forEach((vertexIndex) => {
                    if (vertexIndex < solidVertexSelection1.length) {
                         solidVertexSelection1[vertexIndex] = 1.0;
                    }
                    if (vertexIndex < wireframeVertexSelection1.length) {
                         wireframeVertexSelection1[vertexIndex] = 1.0;
                    }
               });
          }

          // Mark vertices for right wing (Set 2)
          if (set2Data) {
               set2Data.selectedVertices.forEach((vertexIndex) => {
                    if (vertexIndex < solidVertexSelection2.length) {
                         solidVertexSelection2[vertexIndex] = 1.0;
                    }
                    if (vertexIndex < wireframeVertexSelection2.length) {
                         wireframeVertexSelection2[vertexIndex] = 1.0;
                    }
               });
          }

          // Wing flapping vertex shader
          const vertexShader = `
            uniform float time1;
            uniform float time2;
            uniform float rotationAngle1;
            uniform float rotationAngle2;
            uniform bool isAnimating1;
            uniform bool isAnimating2;
            uniform vec3 hingeAxis1;
            uniform vec3 hingeAxis2;
            uniform vec3 hingePoint1;
            uniform vec3 hingePoint2;
            
            attribute float vertexSelection1;
            attribute float vertexSelection2;
            
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying float vSelected1;
            varying float vSelected2;
            
            // Rotate a point around an arbitrary axis
            vec3 rotateAroundAxis(vec3 point, vec3 axis, vec3 center, float angle) {
                vec3 p = point - center;
                
                // Rodrigues' rotation formula
                vec3 rotated = p * cos(angle) + 
                               cross(axis, p) * sin(angle) + 
                               axis * dot(axis, p) * (1.0 - cos(angle));
                
                return rotated + center;
            }
            
            void main() {
                vec3 newPosition = position;
                vSelected1 = vertexSelection1;
                vSelected2 = vertexSelection2;
                
                // Apply left wing animation (Set 1)
                if (isAnimating1 && vertexSelection1 > 0.5) {
                    vec3 toHinge1 = position - hingePoint1;
                    vec3 projected1 = hingePoint1 + hingeAxis1 * dot(toHinge1, hingeAxis1);
                    float distanceFromHinge1 = length(position - projected1);
                    float falloff1 = smoothstep(0.0, 2.0, distanceFromHinge1);
                    float animAngle1 = sin(time1) * rotationAngle1 * falloff1;
                    newPosition = rotateAroundAxis(newPosition, hingeAxis1, hingePoint1, animAngle1);
                }
                
                // Apply right wing animation (Set 2)
                if (isAnimating2 && vertexSelection2 > 0.5) {
                    vec3 toHinge2 = newPosition - hingePoint2;
                    vec3 projected2 = hingePoint2 + hingeAxis2 * dot(toHinge2, hingeAxis2);
                    float distanceFromHinge2 = length(newPosition - projected2);
                    float falloff2 = smoothstep(0.0, 2.0, distanceFromHinge2);
                    float animAngle2 = sin(time2) * rotationAngle2 * falloff2;
                    newPosition = rotateAroundAxis(newPosition, hingeAxis2, hingePoint2, animAngle2);
                }
                
                vPosition = newPosition;
                vNormal = normal;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `;

          // Fragment shader for solid mesh
          const solidFragmentShader = `
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying float vSelected1;
            varying float vSelected2;
            
            uniform vec3 craneColor;
            uniform bool useWhiteColor;
            
            void main() {
                // Simple lighting calculation
                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                float diff = max(dot(normalize(vNormal), lightDir), 0.0);
                
                vec3 color = useWhiteColor ? vec3(1.0, 1.0, 1.0) : craneColor;
                
                // Apply lighting
                color = color * (0.7 + 0.3 * diff);
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;

          // Fragment shader for wireframe
          const wireframeFragmentShader = `
            void main() {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
        `;

          // Create combined uniforms
          const wingUniforms = {
               time1: crane.animationSet1.animationUniforms.time,
               time2: crane.animationSet2.animationUniforms.time,
               rotationAngle1: crane.animationSet1.animationUniforms.rotationAngle,
               rotationAngle2: crane.animationSet2.animationUniforms.rotationAngle,
               isAnimating1: crane.animationSet1.animationUniforms.isAnimating,
               isAnimating2: crane.animationSet2.animationUniforms.isAnimating,
               hingeAxis1: { value: set1Data?.hingeData?.axis || new THREE.Vector3(1, 0, 0) },
               hingeAxis2: { value: set2Data?.hingeData?.axis || new THREE.Vector3(0, 1, 0) },
               hingePoint1: { value: set1Data?.hingeData?.point || new THREE.Vector3(0, 0, 0) },
               hingePoint2: { value: set2Data?.hingeData?.point || new THREE.Vector3(0, 0, 0) },
               craneColor: { value: new THREE.Color(craneColor) },
               useWhiteColor: { value: !cranesColored },
          };

          // Create shader materials
          const solidWingMaterial = new THREE.ShaderMaterial({
               uniforms: wingUniforms,
               vertexShader: vertexShader,
               fragmentShader: solidFragmentShader,
               side: THREE.DoubleSide,
          });

          const wireframeWingMaterial = new THREE.ShaderMaterial({
               uniforms: { ...wingUniforms },
               vertexShader: vertexShader,
               fragmentShader: wireframeFragmentShader,
          });

          // Set vertex selection attributes
          solidGeometry.setAttribute("vertexSelection1", new THREE.BufferAttribute(solidVertexSelection1, 1));
          solidGeometry.setAttribute("vertexSelection2", new THREE.BufferAttribute(solidVertexSelection2, 1));
          wireframeGeometry.setAttribute("vertexSelection1", new THREE.BufferAttribute(wireframeVertexSelection1, 1));
          wireframeGeometry.setAttribute("vertexSelection2", new THREE.BufferAttribute(wireframeVertexSelection2, 1));

          // Apply wing flapping materials
          solidMesh.material = solidWingMaterial;
          wireframeMesh.material = wireframeWingMaterial;
     });

     console.log(`Applied wing flapping animation to crane ${crane.id}`);
}

function startProgram() {
     if (!originalCraneObject) {
          console.warn("Crane model not loaded yet");
          return;
     }

     programRunning = true;

     // Generate initial paths
     generateMultiplePaths();

     // Create cranes for all paths
     createAnimatingCranes();

     // Start animation
     animationActive = true;
     animationTime = 0;

     // Auto-enable wing flapping
     wingFlapEnabled = true;
     wingFlapTime = 0;

     updateUI();

     console.log(`Started program with ${numberOfCranes} cranes`);
}

function stopProgram() {
     programRunning = false;
     animationActive = false;
     wingFlapEnabled = false;

     // Clear all cranes and paths
     clearExistingPaths();

     updateUI();

     console.log("Program stopped and screen cleared");
}

function regenerateRandomPaths() {
     if (!programRunning) return;

     // Stop current animation
     animationActive = false;

     // Generate new paths
     generateMultiplePaths();

     // Recreate cranes
     createAnimatingCranes();

     // Restart animation
     animationActive = true;
     animationTime = 0;

     console.log(`Regenerated random paths with ${numberOfCranes} cranes`);
}

function updateCraneColors() {
     pathsData.forEach((pathData) => {
          if (pathData.crane && pathData.crane.meshGroups) {
               pathData.crane.meshGroups.forEach((group) => {
                    const solidMesh = group.userData.solidMesh;
                    if (solidMesh.material.uniforms && solidMesh.material.uniforms.useWhiteColor) {
                         solidMesh.material.uniforms.useWhiteColor.value = !cranesColored;
                    }
               });
          }
     });
}

function updateCraneScale() {
     pathsData.forEach((pathData) => {
          if (pathData.crane && pathData.crane.craneObject && pathData.crane.initialScale) {
               // Scale relative to the initial scale, not the current scale
               const targetScale = pathData.crane.initialScale * craneScale;
               pathData.crane.craneObject.scale.setScalar(targetScale);
          }
     });
}

function updateAnimation() {
     if (!animationActive || pathsData.length === 0) {
          return;
     }

     // Update all cranes along their respective paths
     pathsData.forEach((pathData, index) => {
          const crane = pathData.crane;
          if (!crane || !crane.craneObject || !pathData.curvePoints) return;

          // Increment frame counter
          crane.frameCount++;

          const curvePoints = pathData.curvePoints;
          const progress = (animationTime * animationSpeed) % (curvePoints.length - 1);
          const progressIndex = Math.floor(progress);
          const fraction = progress - progressIndex;

          if (progressIndex < curvePoints.length - 1) {
               // Interpolate between current and next point
               const currentPoint = curvePoints[progressIndex];
               const nextPoint = curvePoints[progressIndex + 1];
               const position = new THREE.Vector3().lerpVectors(currentPoint, nextPoint, fraction);

               crane.craneObject.position.copy(position);

               // Make crane visible after a few frames to allow initial alignment
               if (crane.frameCount > 10 && !crane.isVisible) {
                    crane.isVisible = true;
                    console.log(`Crane ${index + 1} is now visible - full constraints active`);
               }

               // Calculate movement direction for this crane
               crane.currentDirection = crane.calculateMovementDirectionForPath(animationTime, animationSpeed);

               // Apply rotation based on movement direction with smoothing
               crane.applySmoothedRotation();
          } else {
               // Reset to beginning
               crane.craneObject.position.copy(curvePoints[0]);
               crane.frameCount = 0;
               crane.isVisible = false;
               crane.pastStates = [];
               // Reset smoothing state
               crane.smoothedQuaternion = new THREE.Quaternion();
               crane.targetQuaternion = new THREE.Quaternion();
          }

          // Update crane animations (wing flapping)
          crane.updateAnimation();
     });

     // Increment animation time
     animationTime += 1;
}

function updateUI() {
     const startStopButton = document.getElementById("start-stop-button");
     const newPathsButton = document.getElementById("new-paths-button");
     const addCraneButton = document.getElementById("add-crane-button");
     const removeCraneButton = document.getElementById("remove-crane-button");
     const craneCountInput = document.getElementById("crane-count-input");
     const colorToggleButton = document.getElementById("color-toggle-button");
     const wingFlapButton = document.getElementById("wing-flap-button");
     const statusText = document.querySelector(".status-text");

     if (startStopButton) {
          startStopButton.textContent = programRunning ? "Stop Program" : "Start Program";
          startStopButton.classList.toggle("stop", programRunning);
     }

     if (newPathsButton) {
          newPathsButton.disabled = !programRunning;
     }

     if (addCraneButton) {
          addCraneButton.disabled = !programRunning;
     }

     if (removeCraneButton) {
          removeCraneButton.disabled = !programRunning || numberOfCranes <= 1;
     }

     if (craneCountInput) {
          craneCountInput.disabled = !programRunning;
          craneCountInput.value = numberOfCranes;
     }

     if (colorToggleButton) {
          colorToggleButton.textContent = cranesColored ? "Make White" : "Make Colored";
          colorToggleButton.disabled = !programRunning;
     }

     if (wingFlapButton) {
          wingFlapButton.textContent = wingFlapEnabled ? "Stop Wing Flap" : "Start Wing Flap";
          wingFlapButton.classList.toggle("active", wingFlapEnabled);
          wingFlapButton.disabled = !programRunning;
     }

     if (statusText) {
          if (!programRunning) {
               statusText.textContent = 'Program stopped. Click "Start Program" to begin.';
          } else {
               const wingStatus = wingFlapEnabled ? " with wing flapping" : "";
               const colorStatus = cranesColored ? "colored" : "white";
               statusText.textContent = `Running ${numberOfCranes} ${colorStatus} cranes${wingStatus} at ${(animationSpeed / 0.2).toFixed(1)}x speed.`;
          }
     }
}

function setupControls() {
     // Start/Stop Program button
     const startStopButton = document.getElementById("start-stop-button");
     if (startStopButton) {
          startStopButton.addEventListener("click", () => {
               if (programRunning) {
                    stopProgram();
               } else {
                    startProgram();
               }
          });
     }

     // New Random Paths button
     const newPathsButton = document.getElementById("new-paths-button");
     if (newPathsButton) {
          newPathsButton.addEventListener("click", regenerateRandomPaths);
     }

     // Add crane button
     const addCraneButton = document.getElementById("add-crane-button");
     if (addCraneButton) {
          addCraneButton.addEventListener("click", () => {
               if (numberOfCranes < 100) {
                    numberOfCranes++;
                    regenerateRandomPaths();
                    updateUI();
               }
          });
     }

     // Remove crane button
     const removeCraneButton = document.getElementById("remove-crane-button");
     if (removeCraneButton) {
          removeCraneButton.addEventListener("click", () => {
               if (numberOfCranes > 1) {
                    numberOfCranes--;
                    regenerateRandomPaths();
                    updateUI();
               }
          });
     }

     // Crane count input
     const craneCountInput = document.getElementById("crane-count-input");
     if (craneCountInput) {
          craneCountInput.addEventListener("input", function () {
               const value = parseInt(this.value);
               if (value >= 1 && value <= 100) {
                    numberOfCranes = value;
                    regenerateRandomPaths();
                    updateUI();
               }
          });
     }

     // Color toggle button
     const colorToggleButton = document.getElementById("color-toggle-button");
     if (colorToggleButton) {
          colorToggleButton.addEventListener("click", () => {
               cranesColored = !cranesColored;
               updateCraneColors();
               updateUI();
          });
     }

     // Animation speed slider
     const speedSlider = document.getElementById("speed-slider");
     const speedValue = document.getElementById("speed-value");
     if (speedSlider && speedValue) {
          speedSlider.value = animationSpeed / 0.2; // Convert to multiplier
          speedValue.textContent = `${speedSlider.value}x`;

          speedSlider.addEventListener("input", function () {
               const multiplier = parseFloat(this.value);
               animationSpeed = 0.2 * multiplier;
               speedValue.textContent = `${multiplier}x`;
               console.log(`Animation speed updated to ${animationSpeed} (${multiplier}x default)`);
          });
     }

     // Wing flap speed slider
     const wingSpeedSlider = document.getElementById("wing-speed-slider");
     const wingSpeedValue = document.getElementById("wing-speed-value");
     if (wingSpeedSlider && wingSpeedValue) {
          wingSpeedSlider.value = wingFlapSpeed / 5.0; // Convert to multiplier
          wingSpeedValue.textContent = `${wingSpeedSlider.value}x`;

          wingSpeedSlider.addEventListener("input", function () {
               const multiplier = parseFloat(this.value);
               wingFlapSpeed = 5.0 * multiplier;
               wingSpeedValue.textContent = `${multiplier}x`;
               console.log(`Wing flap speed updated to ${wingFlapSpeed} (${multiplier}x default)`);
          });
     }

     // Crane scale slider
     const scaleSlider = document.getElementById("scale-slider");
     const scaleValue = document.getElementById("scale-value");
     if (scaleSlider && scaleValue) {
          // Initialize the display value
          scaleValue.textContent = `${craneScale.toFixed(1)}x`;

          scaleSlider.addEventListener("input", function () {
               const multiplier = parseFloat(this.value);
               craneScale = 2.0 * multiplier; // Relative to 2.0x base scale
               scaleValue.textContent = `${craneScale.toFixed(1)}x`;
               updateCraneScale();
               console.log(`Crane scale updated to ${craneScale}x`);
          });
     }

     // Wing flapping toggle button
     const wingFlapButton = document.getElementById("wing-flap-button");
     if (wingFlapButton) {
          wingFlapButton.addEventListener("click", () => {
               wingFlapEnabled = !wingFlapEnabled;

               // Update all cranes' wing flap state
               pathsData.forEach((pathData) => {
                    if (pathData.crane) {
                         if (wingFlapEnabled) {
                              pathData.crane.startWingFlap();
                         } else {
                              pathData.crane.stopWingFlap();
                         }
                    }
               });

               updateUI();
               console.log(`Wing flap animation ${wingFlapEnabled ? "started" : "stopped"}`);
          });
     }

     // Compass navigation
     const compassArms = document.querySelectorAll(".compass-arm");
     compassArms.forEach((arm) => {
          arm.addEventListener("click", () => {
               const direction = arm.getAttribute("data-direction");
               snapCameraToDirection(direction);
          });
     });

     // Camera reset button
     const cameraResetButton = document.getElementById("camera-reset");
     if (cameraResetButton) {
          cameraResetButton.addEventListener("click", resetCameraView);
     }
}

// Camera control functions
function snapCameraToDirection(direction) {
     if (!camera || !controls) return;

     const distance = camera.position.distanceTo(controls.target);
     let newPosition;

     switch (direction) {
          case "x-pos":
               // View from positive X axis (looking towards negative X)
               newPosition = new THREE.Vector3(distance, 10, 0);
               break;
          case "x-neg":
               // View from negative X axis (looking towards positive X)
               newPosition = new THREE.Vector3(-distance, 10, 0);
               break;
          case "y-pos":
               // View from positive Y axis (looking down)
               newPosition = new THREE.Vector3(0, distance + 10, 0);
               break;
          case "y-neg":
               // View from negative Y axis (looking up)
               newPosition = new THREE.Vector3(0, -distance + 10, 0);
               break;
          default:
               return;
     }

     // Smoothly animate camera to new position
     animateCameraToPosition(newPosition, controls.target);
}

function resetCameraView() {
     if (!camera || !controls) return;

     // Reset to the default camera position
     const defaultPosition = new THREE.Vector3(0, 10, 50);
     const defaultTarget = new THREE.Vector3(0, 10, 0);

     animateCameraToPosition(defaultPosition, defaultTarget);
}

function animateCameraToPosition(targetPosition, targetLookAt) {
     if (!camera || !controls) return;

     const startPosition = camera.position.clone();
     const startTarget = controls.target.clone();
     const duration = 800; // Animation duration in milliseconds
     const startTime = Date.now();

     function animate() {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // Use easeInOutCubic for smooth animation
          const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

          // Interpolate camera position
          camera.position.lerpVectors(startPosition, targetPosition, eased);

          // Interpolate camera target
          controls.target.lerpVectors(startTarget, targetLookAt, eased);

          // Update controls
          controls.update();

          if (progress < 1) {
               requestAnimationFrame(animate);
          } else {
               // Ensure final position is exact
               camera.position.copy(targetPosition);
               controls.target.copy(targetLookAt);
               controls.update();
               console.log("Camera animation completed");
          }
     }

     animate();
}

function onWindowResize() {
     camera.aspect = window.innerWidth / window.innerHeight;
     camera.updateProjectionMatrix();
     renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
     requestAnimationFrame(animate);

     const deltaTime = 0.016; // Approximately 60 FPS

     // Update wing flapping time for global use
     if (wingFlapEnabled) {
          wingFlapTime += deltaTime * wingFlapSpeed;
     }

     // Update flight path animation
     if (animationActive) {
          animationTime += deltaTime;
          updateAnimation();
     }

     // Update controls
     controls.update();

     // Render the scene
     renderer.render(scene, camera);
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", initCraneAnimation);
