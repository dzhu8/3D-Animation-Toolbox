import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

class ModelVisualizer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.raycaster = null;
        this.mouse = null;
        
        this.currentModel = null;
        this.originalMaterials = new Map();
        this.faceSelectionMode = false;
        this.selectedFace = null;
        this.highlightMaterial = null;
        this.mouseDownPosition = null;
        
        this.init();
        this.setupEventListeners();
    }

    init() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a2a2a);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(5, 5, 5);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        const rendererContainer = document.getElementById('renderer');
        rendererContainer.appendChild(this.renderer.domElement);

        // Controls setup
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Raycaster for face selection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Materials
        this.highlightMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xff6600,
            transparent: true,
            opacity: 0.8
        });

        // Lighting
        this.setupLighting();

        // Start render loop
        this.animate();
    }

    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.9);
        this.scene.add(ambientLight);

        // Directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);

        // Point lights for better illumination
        const pointLight1 = new THREE.PointLight(0xffffff, 0.5);
        pointLight1.position.set(-10, 10, -10);
        this.scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0xffffff, 0.3);
        pointLight2.position.set(10, -10, 10);
        this.scene.add(pointLight2);
    }

    setupEventListeners() {
        // File input and drop zone
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        
        // Click to open file dialog
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        // Drag and drop events
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files);
            this.handleFiles(files);
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            this.handleFiles(files);
        });

        // UI controls
        document.getElementById('resetView').addEventListener('click', () => {
            this.resetCameraView();
        });

        document.getElementById('loadNew').addEventListener('click', () => {
            this.clearScene();
            this.showDropZone();
        });

        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            if (e.code === 'KeyF') {
                e.preventDefault();
                this.toggleFaceSelectionMode();
            }
        });

        // Mouse events for face selection
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            if (this.faceSelectionMode && this.currentModel) {
                this.onMouseDown(e);
            }
        });

        this.renderer.domElement.addEventListener('mouseup', (e) => {
            if (this.faceSelectionMode && this.currentModel) {
                this.onMouseUp(e);
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.onWindowResize();
        });
    }

    handleFiles(files) {
        if (files.length === 0) return;

        // For now, handle the first file
        const file = files[0];
        this.loadModel(file);
    }

    loadModel(file) {
        this.showLoading();
        this.hideDropZone();

        const fileName = file.name;
        const extension = fileName.split('.').pop().toLowerCase();

        // Create object URL for the file
        const url = URL.createObjectURL(file);

        // Choose appropriate loader based on file extension
        let loader = null;
        
        switch (extension) {
            case 'obj':
                loader = new OBJLoader();
                break;
            case 'ply':
                loader = new PLYLoader();
                break;
            case 'stl':
                loader = new STLLoader();
                break;
            case 'gltf':
            case 'glb':
                loader = new GLTFLoader();
                break;
            case 'fbx':
                loader = new FBXLoader();
                break;
            default:
                this.showError(`Unsupported file format: ${extension}`);
                return;
        }

        // Load the model
        loader.load(
            url,
            (result) => {
                this.onModelLoaded(result, fileName, extension);
                URL.revokeObjectURL(url);
            },
            (progress) => {
                console.log('Loading progress:', progress);
            },
            (error) => {
                console.error('Error loading model:', error);
                this.showError('Failed to load model');
                URL.revokeObjectURL(url);
            }
        );
    }

    onModelLoaded(result, fileName, extension) {
        this.clearScene();

        let object = null;

        // Handle different loader result formats
        if (extension === 'gltf' || extension === 'glb') {
            object = result.scene;
        } else if (result.isGeometry || result.isBufferGeometry) {
            // For geometries (PLY, STL)
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xffffff,  // White color
                side: THREE.DoubleSide
            });
            object = new THREE.Mesh(result, material);
        } else {
            // For objects (OBJ, FBX)
            object = result;
        }

        // Ensure all meshes have proper materials
        object.traverse((child) => {
            if (child.isMesh) {
                if (!child.material) {
                    child.material = new THREE.MeshLambertMaterial({ 
                        color: 0xffffff,  // White color
                        side: THREE.DoubleSide
                    });
                }
                
                // Override material to be white
                if (child.material) {
                    child.material.color.setHex(0xffffff);  // Set to white
                }
                
                // Store original materials for face selection
                this.originalMaterials.set(child, child.material.clone());
                
                // Enable shadows
                child.castShadow = true;
                child.receiveShadow = true;
                
                // Add wireframe overlay for edges
                this.addWireframeOverlay(child);
            }
        });

        // Add to scene
        this.scene.add(object);
        this.currentModel = object;

        // Center and scale the model
        this.centerAndScaleModel(object);

        // Update UI
        this.updateUI(fileName);
        this.hideLoading();

        console.log('Model loaded successfully:', object);
    }

    addWireframeOverlay(mesh) {
        // Create wireframe geometry
        const wireframeGeometry = new THREE.WireframeGeometry(mesh.geometry);
        
        // Create black wireframe material
        const wireframeMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000,  // Black color
            linewidth: 1,
            transparent: true,
            opacity: 0.8
        });
        
        // Create wireframe mesh
        const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
        
        // Add wireframe as child of the mesh so it moves with the mesh
        mesh.add(wireframe);
        
        // Store reference for cleanup
        mesh.userData.wireframe = wireframe;
    }

    centerAndScaleModel(object) {
        // Calculate bounding box
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Center the object at the origin
        object.position.sub(center);

        // Optional: Scale the model if it's extremely large or small
        // This helps ensure models of very different scales are viewable
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // Only scale if the model is extremely large (>100 units) or very small (<0.1 units)
        if (maxDim > 100) {
            const scale = 50 / maxDim; // Scale down large models
            object.scale.setScalar(scale);
            console.log(`Model scaled down by factor ${scale.toFixed(3)} (original max dimension: ${maxDim.toFixed(2)})`);
        } else if (maxDim < 0.1) {
            const scale = 5 / maxDim; // Scale up very small models
            object.scale.setScalar(scale);
            console.log(`Model scaled up by factor ${scale.toFixed(3)} (original max dimension: ${maxDim.toFixed(4)})`);
        }

        // Position camera appropriately based on the final model size
        this.resetCameraView();
    }

    resetCameraView() {
        if (this.currentModel) {
            const box = new THREE.Box3().setFromObject(this.currentModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            
            // Calculate the maximum dimension of the model
            const maxDim = Math.max(size.x, size.y, size.z);
            
            // Calculate distance needed to fit the model in view
            // Using the camera's field of view to determine appropriate distance
            const fov = this.camera.fov * (Math.PI / 180); // Convert to radians
            const distance = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
            
            // Add 20% padding to the distance for better framing
            const paddedDistance = distance * 1.2;
            
            // Position camera at a nice angle (45 degrees around Y, 30 degrees up)
            const theta = Math.PI / 4; // 45 degrees around Y-axis
            const phi = Math.PI / 6;   // 30 degrees up from horizontal
            
            // Calculate camera position based on spherical coordinates
            const x = center.x + paddedDistance * Math.sin(phi) * Math.cos(theta);
            const y = center.y + paddedDistance * Math.cos(phi);
            const z = center.z + paddedDistance * Math.sin(phi) * Math.sin(theta);
            
            this.camera.position.set(x, y, z);
            this.camera.lookAt(center);
            
            // Update controls target to the model center
            this.controls.target.copy(center);
        } else {
            // Default position when no model is loaded
            this.camera.position.set(5, 5, 5);
            this.camera.lookAt(0, 0, 0);
            this.controls.target.set(0, 0, 0);
        }
        
        this.controls.update();
    }

    toggleFaceSelectionMode() {
        this.faceSelectionMode = !this.faceSelectionMode;
        
        const faceInfo = document.getElementById('faceInfo');
        if (this.faceSelectionMode) {
            faceInfo.style.display = 'block';
            // Keep orbit controls enabled in face selection mode
            this.controls.enabled = true;
        } else {
            faceInfo.style.display = 'none';
            this.controls.enabled = true;
            this.clearFaceSelection();
        }

        console.log('Face selection mode:', this.faceSelectionMode ? 'ON' : 'OFF');
    }

    onMouseDown(event) {
        if (!this.currentModel) return;

        // Store the mouse down position
        this.mouseDownPosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    onMouseUp(event) {
        if (!this.currentModel || !this.mouseDownPosition) return;

        // Calculate how much the mouse moved during the click
        const mouseUpPosition = {
            x: event.clientX,
            y: event.clientY
        };

        const mouseMoveDistance = Math.sqrt(
            Math.pow(mouseUpPosition.x - this.mouseDownPosition.x, 2) +
            Math.pow(mouseUpPosition.y - this.mouseDownPosition.y, 2)
        );

        // Only treat as a "click" if mouse didn't move much (less than 5 pixels)
        // This allows camera rotation when dragging but face selection when clicking
        if (mouseMoveDistance < 5) {
            this.onMouseClick(event);
        }

        this.mouseDownPosition = null;
    }

    onMouseClick(event) {
        if (!this.currentModel) return;

        // Calculate mouse position in normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Find intersections with the model
        const intersects = this.raycaster.intersectObject(this.currentModel, true);

        if (intersects.length > 0) {
            // Clicked on the object - select face
            const intersection = intersects[0];
            this.selectFace(intersection);
        }
        // If no intersections, we clicked in empty space - camera rotation is handled by OrbitControls
    }

    selectFace(intersection) {
        // Clear previous selection
        this.clearFaceSelection();

        const mesh = intersection.object;
        const faceIndex = intersection.faceIndex;

        if (faceIndex !== undefined) {
            // Create a geometry with just the selected face highlighted
            this.highlightFace(mesh, faceIndex);
            
            // Update UI
            document.getElementById('selectedFace').textContent = faceIndex;
            
            console.log('Selected face:', faceIndex, 'on mesh:', mesh);
        }
    }

    highlightFace(mesh, faceIndex) {
        // Store the selected face info
        this.selectedFace = { mesh, faceIndex };

        // Clone the geometry to modify it
        const geometry = mesh.geometry.clone();
        const colors = new Float32Array(geometry.attributes.position.count * 3);

        // Set all vertices to original color (white)
        for (let i = 0; i < colors.length; i += 3) {
            colors[i] = 1.0;     // R
            colors[i + 1] = 1.0; // G
            colors[i + 2] = 1.0; // B
        }

        // Highlight the selected face (orange)
        const face = faceIndex;
        const vertexIndices = [face * 3, face * 3 + 1, face * 3 + 2];
        
        for (const vertexIndex of vertexIndices) {
            colors[vertexIndex * 3] = 1.0;     // R
            colors[vertexIndex * 3 + 1] = 0.4; // G
            colors[vertexIndex * 3 + 2] = 0.0; // B
        }

        // Add color attribute to geometry
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Create new material that uses vertex colors
        const material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });

        // Update the mesh
        mesh.geometry.dispose();
        mesh.geometry = geometry;
        if (mesh.material) mesh.material.dispose();
        mesh.material = material;
    }

    clearFaceSelection() {
        if (this.selectedFace) {
            const { mesh } = this.selectedFace;
            
            // Restore original geometry and material
            const originalMaterial = this.originalMaterials.get(mesh);
            if (originalMaterial) {
                if (mesh.material) mesh.material.dispose();
                mesh.material = originalMaterial.clone();
            }

            this.selectedFace = null;
            document.getElementById('selectedFace').textContent = 'None';
        }
    }

    clearScene() {
        if (this.currentModel) {
            // Dispose of geometries and materials
            this.currentModel.traverse((child) => {
                if (child.isMesh) {
                    // Clean up wireframe if it exists
                    if (child.userData.wireframe) {
                        child.remove(child.userData.wireframe);
                        child.userData.wireframe.geometry.dispose();
                        child.userData.wireframe.material.dispose();
                        delete child.userData.wireframe;
                    }
                    
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(material => material.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });

            this.scene.remove(this.currentModel);
            this.currentModel = null;
            this.originalMaterials.clear();
            this.selectedFace = null;
        }

        // Reset UI
        this.faceSelectionMode = false;
        this.controls.enabled = true;
        document.getElementById('faceInfo').style.display = 'none';
    }

    updateUI(fileName) {
        document.getElementById('modelName').textContent = fileName;
        document.getElementById('ui').classList.add('visible');
        document.getElementById('instructions').classList.add('visible');
    }

    showDropZone() {
        document.getElementById('dropZone').classList.remove('hidden');
        document.getElementById('ui').classList.remove('visible');
        document.getElementById('instructions').classList.remove('visible');
    }

    hideDropZone() {
        document.getElementById('dropZone').classList.add('hidden');
    }

    showLoading() {
        document.getElementById('loading').classList.add('visible');
    }

    hideLoading() {
        document.getElementById('loading').classList.remove('visible');
    }

    showError(message) {
        this.hideLoading();
        this.showDropZone();
        alert('Error: ' + message);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize the visualizer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const visualizer = new ModelVisualizer();
});