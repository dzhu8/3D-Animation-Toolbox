// Import Three.js modules
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// Global variables
let scene, camera, renderer, controls;
let crane = null;
let faces = [];
let edges = [];

// Hardcoded animation sets - button controlled
let animationSet1 = {
    selectedFaceIndices: [23, 24, 25, 26, 27, 28, 29, 86, 87, 102, 103], // Hardcoded face indices for Set 1
    hingeEdgeIndex: 80,
    hingeEdgeData: null,
    isAnimationActive: false, // Button controlled
    animationUniforms: null
};

let animationSet2 = {
    selectedFaceIndices: [8, 10, 9, 11, 12, 13, 14, 70, 71, 88, 89], // Hardcoded face indices for Set 2
    hingeEdgeIndex: 35,
    hingeEdgeData: null,
    isAnimationActive: false, // Button controlled
    animationUniforms: null
};

let meshGroups = []; // Store transform nodes for coordinated animation

// Animation configuration
const WING_FLAP_ANGLE = 0.5; // Maximum rotation angle in radians (about 29 degrees)

function initInteractiveOrigamiViewer() {
    const container = document.getElementById('container');
    if (!container) {
        console.error('Container element not found');
        return;
    }

    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    // Create camera
    camera = new THREE.PerspectiveCamera(
        75, 
        window.innerWidth / window.innerHeight, 
        0.1, 
        1000
    );
    camera.position.set(5, 5, 5);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xffffff, 1);
    container.appendChild(renderer.domElement);

    // Add orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI / 1.5;

    // Add lighting
    setupLighting();

    // Load the crane model
    loadInteractiveCraneModel();

    // Initialize animation uniforms
    initializeAnimationUniforms();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start the animation loop
    animate();
}

function setupLighting() {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xf8f8ff, 0.4);
    scene.add(ambientLight);

    // Main directional light (sun-like)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);

    // Fill light from the opposite side
    const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.3);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    // Point light for additional highlights
    const pointLight = new THREE.PointLight(0xffffff, 0.5, 100);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);
}

function initializeAnimationUniforms() {
    // Initialize uniforms for both animation sets
    animationSet1.animationUniforms = {
        time: { value: 0.0 },
        animationPhase: { value: 0.0 },
        rotationAngle: { value: WING_FLAP_ANGLE }, // Use hardcoded wing flap angle
        isAnimating: { value: false } // Button controlled
    };
    
    animationSet2.animationUniforms = {
        time: { value: 0.0 },
        animationPhase: { value: 0.0 },
        rotationAngle: { value: WING_FLAP_ANGLE }, // Use hardcoded wing flap angle
        isAnimating: { value: false } // Button controlled
    };
}

function createCoordinatedWireframe(geometry) {
    // Extract edge indices from face indices
    const position = geometry.attributes.position;
    const edgeIndices = [];
    const edgeSet = new Set();
    
    // Clear edges array for this mesh
    const meshEdges = [];
    
    // Iterate through faces and extract edges
    for (let i = 0; i < position.count; i += 3) {
        const a = i;
        const b = i + 1;
        const c = i + 2;
        
        // Create edges for this triangle (a-b, b-c, c-a)
        const triangleEdges = [
            [a, b],
            [b, c],
            [c, a]
        ];
        
        triangleEdges.forEach(([v1, v2]) => {
            const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edgeIndices.push(v1, v2);
                
                // Store edge data for hinge calculations
                meshEdges.push({
                    index: meshEdges.length,
                    vertices: [v1, v2],
                    v1: new THREE.Vector3().fromBufferAttribute(position, v1),
                    v2: new THREE.Vector3().fromBufferAttribute(position, v2)
                });
            }
        });
    }
    
    // Add edges to global edges array
    edges.push(...meshEdges);
    
    // Create wireframe geometry
    const wireframeGeometry = new THREE.BufferGeometry();
    
    // Copy position attribute from original geometry
    const originalPositions = geometry.attributes.position.array;
    wireframeGeometry.setAttribute('position', 
        new THREE.BufferAttribute(originalPositions.slice(), 3));
    
    // Set the indices for the wireframe lines
    wireframeGeometry.setIndex(edgeIndices);
    
    // Create wireframe material
    const wireframeMaterial = new THREE.LineBasicMaterial({ 
        color: 0x000000, 
        linewidth: 2 
    });
    
    // Create wireframe mesh
    const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    
    console.log(`Created wireframe with ${edgeIndices.length / 2} edges from ${position.count / 3} faces`);
    
    return wireframeMesh;
}

function loadInteractiveCraneModel() {
    const loader = new OBJLoader();
    
    loader.load(
        'assets/crane-3D.obj',
        function (object) {
            // Model loaded successfully
            crane = object;
            
            // Clear any existing mesh groups and edges
            meshGroups = [];
            edges = [];
            
            // Process each mesh in the loaded object
            object.traverse(function (child) {
                if (child.isMesh) {
                    console.log('Processing mesh:', child);
                    
                    // Store original geometry and material
                    const originalGeometry = child.geometry;
                    const originalMaterial = child.material;
                    
                    // Ensure geometry has indices for face extraction
                    if (!originalGeometry.index) {
                        originalGeometry.setIndex(
                            Array.from({length: originalGeometry.attributes.position.count}, (_, i) => i)
                        );
                    }
                    
                    // Create a group to hold both solid mesh and wireframe
                    const meshGroup = new THREE.Group();
                    
                    // Clone the original mesh for animation
                    const solidMesh = new THREE.Mesh(
                        originalGeometry.clone(),
                        originalMaterial.clone()
                    );
                    
                    // Create wireframe
                    const wireframeMesh = createCoordinatedWireframe(originalGeometry);
                    
                    // Add both to the group
                    meshGroup.add(solidMesh);
                    meshGroup.add(wireframeMesh);
                    
                    // Store references for animation
                    meshGroup.userData = {
                        solidMesh: solidMesh,
                        wireframeMesh: wireframeMesh,
                        originalGeometry: originalGeometry.clone(),
                        animationData: {
                            selectedVertices: new Set(),
                            hingeAxis: null,
                            hingePoint: null
                        }
                    };
                    
                    // Replace the original mesh with our group
                    child.parent.add(meshGroup);
                    child.parent.remove(child);
                    
                    meshGroups.push(meshGroup);
                }
            });

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 3 / maxDim; // Scale to fit in a 3 unit box

            object.scale.setScalar(scale);
            object.position.sub(center.multiplyScalar(scale));

            scene.add(object);

            // Update world matrices before extracting faces
            object.updateMatrixWorld(true);

            // Extract faces from the new mesh groups
            meshGroups.forEach(group => {
                const solidMesh = group.userData.solidMesh;
                extractFaces(solidMesh);
            });
            
            // Set up hinge edge data for both sets before starting animation
            setupHingeEdgeData();
            
            // Set up the combined animation materials but don't start yet
            applyCombinedHingeAnimation();
            
            // Set up button event handler
            setupWingFlapButton();
            
            // Update UI
            const loadingDiv = document.getElementById('loading');
            const faceCountSpan = document.getElementById('face-count');
            const statusDiv = document.getElementById('status');
            
            if (loadingDiv) loadingDiv.classList.add('hidden');
            if (faceCountSpan) faceCountSpan.textContent = faces.length;
            if (statusDiv) statusDiv.textContent = 'Ready - Click button to start wing flap animation';
            
            console.log('Interactive 3D Origami Crane loaded successfully!');
            console.log(`Found ${faces.length} faces`);
            console.log(`Found ${edges.length} edges`);
            console.log(`Created ${meshGroups.length} coordinated mesh groups`);
            console.log(`Set 1: Faces [${animationSet1.selectedFaceIndices.join(', ')}] with hinge edge ${animationSet1.hingeEdgeIndex}`);
            console.log(`Set 2: Faces [${animationSet2.selectedFaceIndices.join(', ')}] with hinge edge ${animationSet2.hingeEdgeIndex}`);
            console.log('Wing flap animation ready to start');
        },
        function (progress) {
            console.log('Loading progress:', progress);
        },
        function (error) {
            console.error('Error loading crane model:', error);
        }
    );
}

function extractFaces(mesh) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    
    // Extract faces from the geometry
    for (let i = 0; i < position.count; i += 3) {
        // Get the three vertices of the face
        const faceVertices = [i, i + 1, i + 2];
        const face = {
            index: faces.length,
            vertices: faceVertices,
            mesh: mesh,
            a: i,
            b: i + 1,
            c: i + 2
        };
        faces.push(face);
    }
    
    console.log(`Extracted ${faces.length} faces from mesh`);
}

function setupHingeEdgeData() {
    // Set up hinge edge data for animationSet1
    if (edges.length > animationSet1.hingeEdgeIndex) {
        animationSet1.hingeEdgeData = edges[animationSet1.hingeEdgeIndex];
        console.log(`Set up hinge edge data for Set 1: edge ${animationSet1.hingeEdgeIndex}`);
    } else {
        console.warn(`Hinge edge index ${animationSet1.hingeEdgeIndex} for Set 1 is out of range. Total edges: ${edges.length}`);
    }
    
    // Set up hinge edge data for animationSet2
    if (edges.length > animationSet2.hingeEdgeIndex) {
        animationSet2.hingeEdgeData = edges[animationSet2.hingeEdgeIndex];
        console.log(`Set up hinge edge data for Set 2: edge ${animationSet2.hingeEdgeIndex}`);
    } else {
        console.warn(`Hinge edge index ${animationSet2.hingeEdgeIndex} for Set 2 is out of range. Total edges: ${edges.length}`);
    }
}

function getVerticesFromSelectedFaces(faceIndices) {
    const selectedVertices = new Set();
    
    faceIndices.forEach(faceIndex => {
        if (faceIndex < faces.length) {
            const face = faces[faceIndex];
            face.vertices.forEach(vertexIndex => {
                selectedVertices.add(vertexIndex);
            });
        }
    });
    
    return Array.from(selectedVertices);
}

function calculateHingeAnimation(vertices, hingeEdge) {
    if (!hingeEdge) return null;
    
    // Calculate hinge axis (direction of the edge)
    const hingeAxis = new THREE.Vector3()
        .subVectors(hingeEdge.v2, hingeEdge.v1)
        .normalize();
    
    // Use the first vertex of the hinge edge as the hinge point
    const hingePoint = hingeEdge.v1.clone();
    
    return {
        axis: hingeAxis,
        point: hingePoint,
        vertices: vertices
    };
}

function applyCombinedHingeAnimation() {
    if (!crane) return;
    
    // Prepare data for both animation sets
    const set1Data = animationSet1.selectedFaceIndices.length > 0 ? {
        selectedVertices: getVerticesFromSelectedFaces(animationSet1.selectedFaceIndices),
        hingeData: calculateHingeAnimation([], animationSet1.hingeEdgeData)
    } : null;
    
    const set2Data = animationSet2.selectedFaceIndices.length > 0 ? {
        selectedVertices: getVerticesFromSelectedFaces(animationSet2.selectedFaceIndices),
        hingeData: calculateHingeAnimation([], animationSet2.hingeEdgeData)
    } : null;
    
    // Apply combined animation to all mesh groups
    meshGroups.forEach(group => {
        const userData = group.userData;
        const solidMesh = userData.solidMesh;
        const wireframeMesh = userData.wireframeMesh;
        const solidGeometry = solidMesh.geometry;
        const wireframeGeometry = wireframeMesh.geometry;
        
        // Create vertex selection arrays for both sets
        const solidVertexSelection1 = new Float32Array(solidGeometry.attributes.position.count);
        const wireframeVertexSelection1 = new Float32Array(wireframeGeometry.attributes.position.count);
        const solidVertexSelection2 = new Float32Array(solidGeometry.attributes.position.count);
        const wireframeVertexSelection2 = new Float32Array(wireframeGeometry.attributes.position.count);
        
        solidVertexSelection1.fill(0.0);
        wireframeVertexSelection1.fill(0.0);
        solidVertexSelection2.fill(0.0);
        wireframeVertexSelection2.fill(0.0);
        
        // Mark vertices for Set 1
        if (set1Data) {
            set1Data.selectedVertices.forEach(vertexIndex => {
                if (vertexIndex < solidVertexSelection1.length) {
                    solidVertexSelection1[vertexIndex] = 1.0;
                }
                if (vertexIndex < wireframeVertexSelection1.length) {
                    wireframeVertexSelection1[vertexIndex] = 1.0;
                }
            });
        }
        
        // Mark vertices for Set 2
        if (set2Data) {
            set2Data.selectedVertices.forEach(vertexIndex => {
                if (vertexIndex < solidVertexSelection2.length) {
                    solidVertexSelection2[vertexIndex] = 1.0;
                }
                if (vertexIndex < wireframeVertexSelection2.length) {
                    wireframeVertexSelection2[vertexIndex] = 1.0;
                }
            });
        }
        
        // Create combined shader
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
                
                // Apply Set 1 animation
                if (isAnimating1 && vertexSelection1 > 0.5) {
                    vec3 toHinge1 = position - hingePoint1;
                    vec3 projected1 = hingePoint1 + hingeAxis1 * dot(toHinge1, hingeAxis1);
                    float distanceFromHinge1 = length(position - projected1);
                    float falloff1 = smoothstep(0.0, 2.0, distanceFromHinge1);
                    float animAngle1 = sin(time1 * 3.0) * rotationAngle1 * falloff1;
                    newPosition = rotateAroundAxis(newPosition, hingeAxis1, hingePoint1, animAngle1);
                }
                
                // Apply Set 2 animation
                if (isAnimating2 && vertexSelection2 > 0.5) {
                    vec3 toHinge2 = newPosition - hingePoint2;
                    vec3 projected2 = hingePoint2 + hingeAxis2 * dot(toHinge2, hingeAxis2);
                    float distanceFromHinge2 = length(newPosition - projected2);
                    float falloff2 = smoothstep(0.0, 2.0, distanceFromHinge2);
                    float animAngle2 = sin(time2 * 3.0) * rotationAngle2 * falloff2;
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
            
            void main() {
                // Simple lighting calculation
                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                float diff = max(dot(normalize(vNormal), lightDir), 0.0);
                
                vec3 color = vec3(1.0, 1.0, 1.0); // Pure white paper color
                
                // Slightly highlight selected faces with subtle tints
                if (vSelected1 > 0.5) {
                    color = mix(color, vec3(1.0, 0.95, 1.0), 0.1); // Very subtle purple tint for Set 1
                }
                if (vSelected2 > 0.5) {
                    color = mix(color, vec3(1.0, 0.95, 0.95), 0.1); // Very subtle red tint for Set 2
                }
                
                // Apply very subtle lighting to maintain bright white appearance
                color = color * (0.95 + 0.05 * diff);
                
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
        const combinedUniforms = {
            time1: animationSet1.animationUniforms.time,
            time2: animationSet2.animationUniforms.time,
            rotationAngle1: animationSet1.animationUniforms.rotationAngle,
            rotationAngle2: animationSet2.animationUniforms.rotationAngle,
            isAnimating1: animationSet1.animationUniforms.isAnimating,
            isAnimating2: animationSet2.animationUniforms.isAnimating,
            hingeAxis1: { value: set1Data?.hingeData?.axis || new THREE.Vector3(1,0,0) },
            hingeAxis2: { value: set2Data?.hingeData?.axis || new THREE.Vector3(0,1,0) },
            hingePoint1: { value: set1Data?.hingeData?.point || new THREE.Vector3(0,0,0) },
            hingePoint2: { value: set2Data?.hingeData?.point || new THREE.Vector3(0,0,0) }
        };
        
        // Create materials
        const solidAnimatedMaterial = new THREE.ShaderMaterial({
            uniforms: combinedUniforms,
            vertexShader: vertexShader,
            fragmentShader: solidFragmentShader,
            side: THREE.DoubleSide
        });
        
        const wireframeAnimatedMaterial = new THREE.ShaderMaterial({
            uniforms: { ...combinedUniforms },
            vertexShader: vertexShader,
            fragmentShader: wireframeFragmentShader
        });
        
        // Set vertex selection attributes
        solidGeometry.setAttribute('vertexSelection1', new THREE.BufferAttribute(solidVertexSelection1, 1));
        solidGeometry.setAttribute('vertexSelection2', new THREE.BufferAttribute(solidVertexSelection2, 1));
        wireframeGeometry.setAttribute('vertexSelection1', new THREE.BufferAttribute(wireframeVertexSelection1, 1));
        wireframeGeometry.setAttribute('vertexSelection2', new THREE.BufferAttribute(wireframeVertexSelection2, 1));
        
        // Apply materials
        solidMesh.material = solidAnimatedMaterial;
        wireframeMesh.material = wireframeAnimatedMaterial;
    });
    
    console.log('Applied combined hinge animation for both sets');
}

function setupWingFlapButton() {
    const wingFlapButton = document.getElementById('wing-flap-button');
    if (wingFlapButton) {
        wingFlapButton.addEventListener('click', toggleWingFlap);
        console.log('Wing flap button event handler set up');
    } else {
        console.warn('Wing flap button not found');
    }
}

function toggleWingFlap() {
    const isCurrentlyAnimating = animationSet1.isAnimationActive && animationSet2.isAnimationActive;
    const newState = !isCurrentlyAnimating;
    
    // Toggle both animation sets
    animationSet1.isAnimationActive = newState;
    animationSet2.isAnimationActive = newState;
    
    // Update uniforms
    if (animationSet1.animationUniforms) {
        animationSet1.animationUniforms.isAnimating.value = newState;
    }
    if (animationSet2.animationUniforms) {
        animationSet2.animationUniforms.isAnimating.value = newState;
    }
    
    // Update button appearance and text
    const wingFlapButton = document.getElementById('wing-flap-button');
    const statusDiv = document.getElementById('status');
    
    if (wingFlapButton) {
        if (newState) {
            wingFlapButton.textContent = 'Stop Wing Flap';
            wingFlapButton.classList.add('stop');
        } else {
            wingFlapButton.textContent = 'Start Wing Flap';
            wingFlapButton.classList.remove('stop');
        }
    }
    
    if (statusDiv) {
        statusDiv.textContent = newState ? 
            'Wing flap animation active - Set 1 and Set 2' : 
            'Wing flap animation stopped - Click button to restart';
    }
    
    console.log(`Wing flap animation ${newState ? 'started' : 'stopped'}`);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    
    // Update animation uniforms for both sets
    [animationSet1, animationSet2].forEach(animationSet => {
        if (animationSet.animationUniforms) {
            if (animationSet.animationUniforms.isAnimating.value) {
                animationSet.animationUniforms.time.value += 0.016; // Approximately 60 FPS
                animationSet.animationUniforms.animationPhase.value = Math.sin(animationSet.animationUniforms.time.value * 2.0);
            } else {
                animationSet.animationUniforms.time.value = 0.0;
            }
        }
    });
    
    // Update controls
    controls.update();
    
    // Render the scene
    renderer.render(scene, camera);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initInteractiveOrigamiViewer);


