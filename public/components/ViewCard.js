// ViewCard.js
import BaseCard from "./BaseCard.js";
import BaseSocket from "./BaseSocket.js";

import {
    updateSocketArray,
    createSocketUpdateEvent,
    createSocket,
    generateSocketId,
  } from "../utils/socketManagement/socketRemapping.js";
  

export default {
  name: "ViewCard",
  components: { BaseCard, BaseSocket },
  props: {
    cardData: { type: Object, required: true },
    zoomLevel: { type: Number, default: 1 },
    zIndex: { type: Number, default: 1 },
    isSelected: { type: Boolean, default: false },
  },
  template: `
    <div>
      <BaseCard
        :card-data="localCardData"
        :zoom-level="zoomLevel"
        :z-index="zIndex"
        :is-selected="isSelected"
        @update-position="$emit('update-position', $event)"
        @update-card="handleCardUpdate"
        @close-card="$emit('close-card', $event)"
        @clone-card="uuid => $emit('clone-card', uuid)"
        @select-card="$emit('select-card', $event)"
        style = "width:600px"
      >
        <!-- Input Socket -->
        <div class="absolute -left-[12px]" style="top: 16px;">
          <BaseSocket
            v-if="localCardData.sockets.inputs[0]"
            type="input"
            :socket-id="localCardData.sockets.inputs[0].id"
            :card-id="localCardData.uuid"
            :name="localCardData.sockets.inputs[0].name"
            :value="localCardData.sockets.inputs[0].value"
            :is-connected="getSocketConnections(localCardData.sockets.inputs[0].id)"
            :has-error="hasSocketError(localCardData.sockets.inputs[0])"
            :zoom-level="zoomLevel"
            @connection-drag-start="emitWithCardId('connection-drag-start', $event)"
            @connection-drag="$emit('connection-drag', $event)"
            @connection-drag-end="$emit('connection-drag-end', $event)"
            @socket-mounted="handleSocketMount($event)"
          />
        </div>

        <!-- Content -->
        <div 
          class="p-4 text-sm" 
          v-show="localCardData.display == 'default'"
        >
          <div class="bg-[#12141a] border border-gray-800 rounded-lg p-4 max-h-[400px] overflow-y-auto" @mousedown.stop>
            <!-- JSON View -->
            <pre v-if="isJsonContent" class="text-gray-300 whitespace-pre-wrap font-mono">{{ formattedJson }}</pre>
            
            <!-- Markdown View -->
            <div v-else class="markdown-dark">
              <div v-html="renderedContent"></div>
            </div>
          </div>
        </div>

      </BaseCard>
    </div>
  `,

  setup(props, { emit }) {
    const socketRegistry = new Map();
    const connections = Vue.ref(new Set());
    const isProcessing = Vue.ref(false);

    // Initialize card data with a single input socket
    const initializeCardData = (data) => {
      // Create initial socket
      const initialSocket = createSocket({
        type: "input",
        index: 0,
        existingId: data.sockets?.inputs?.[0]?.id,
        value: data.sockets?.inputs?.[0]?.value
      });

      const baseData = {
        uuid: data.uuid,
        name: data.name || "View",
        description: data.description || "View Node",
        display: data.display || "default",
        x: data.x || 0,
        y: data.y || 0,
        sockets: {
          inputs: [initialSocket],
          outputs: []
        }
      };

      // Emit socket registration event
      emit(
        "sockets-updated",
        createSocketUpdateEvent({
          cardId: data.uuid,
          oldSockets: [],
          newSockets: [initialSocket],
          reindexMap: new Map([[null, initialSocket.id]]),
          deletedSocketIds: [],
          type: "input",
        })
      );

      return baseData;
    };

    // Initialize local state
    const localCardData = Vue.ref(initializeCardData(props.cardData));

    // Content processing and rendering
    const isJsonContent = Vue.computed(() => {
      const value = localCardData.value.sockets.inputs[0]?.value;
      if (!value) return false;
      
      if (typeof value === 'object') {
        return true;
      }

      if (typeof value === 'string') {
        try {
          const trimmed = value.trim();
          return (trimmed.startsWith('{') && trimmed.endsWith('}')) || 
                 (trimmed.startsWith('[') && trimmed.endsWith(']'));
        } catch {
          return false;
        }
      }

      return false;
    });

    const formattedJson = Vue.computed(() => {
      const value = localCardData.value.sockets.inputs[0]?.value;
      if (!value) return '';

      try {
        const content = typeof value === 'string' ? JSON.parse(value) : value;
        return JSON.stringify(content, null, 2);
      } catch {
        return '';
      }
    });

    const renderedContent = Vue.computed(() => {
      const value = localCardData.value.sockets.inputs[0]?.value;
      if (!value) return '';

      try {
        if (typeof value === 'object') {
          return markdownit().render(JSON.stringify(value, null, 2));
        }

        const content = typeof value.content === 'string' ? value.content : value;
        return markdownit().render(content);
      } catch (error) {
        console.error('Error rendering content:', error);
        return '<p class="text-red-500">Error rendering content</p>';
      }
    });

    // Socket connection tracking
    const getSocketConnections = (socketId) => connections.value.has(socketId);
    const hasSocketError = (socket) => false;

    const handleSocketMount = (event) => {
      if (!event) return;
      socketRegistry.set(event.socketId, {
        element: event.element,
        cleanup: [],
      });
    };

    // Helper to emit events with card ID
    const emitWithCardId = (eventName, event) => {
      emit(eventName, { ...event, cardId: localCardData.value.uuid });
    };

    // Handle card updates
    const handleCardUpdate = (data) => {
      if (isProcessing.value) return;
      if (data) {
        isProcessing.value = true;
        try {
          localCardData.value = data;
          emit("update-card", Vue.toRaw(localCardData.value));
        } finally {
          isProcessing.value = false;
        }
      }
    };

    // Watch for card data changes
    Vue.watch(
      () => props.cardData,
      (newData, oldData) => {
        if (!newData || isProcessing.value) return;
        isProcessing.value = true;

        try {
          // Update position
          if (newData.x !== oldData?.x) localCardData.value.x = newData.x;
          if (newData.y !== oldData?.y) localCardData.value.y = newData.y;

          // Safely update socket value if it exists and has changed
          const newValue = newData.sockets?.inputs?.[0]?.value;
          const currentSocket = localCardData.value.sockets.inputs[0];
          
          if (currentSocket && newValue !== undefined && currentSocket.value !== newValue) {
            currentSocket.value = newValue;
            currentSocket.momentUpdated = Date.now();
          }
        } finally {
          isProcessing.value = false;
        }
      },
      { deep: true }
    );

    // Initialize socket connections
    Vue.onMounted(() => {
      if (props.cardData.sockets?.inputs?.[0]) {
        connections.value = new Set([props.cardData.sockets.inputs[0].id]);
      }
    });

    // Cleanup on unmount
    Vue.onUnmounted(() => {
      socketRegistry.forEach((socket) => {
        socket.cleanup.forEach((cleanup) => cleanup());
      });
      socketRegistry.clear();
      connections.value.clear();
    });

    return {
      localCardData,
      isJsonContent,
      formattedJson,
      renderedContent,
      getSocketConnections,
      hasSocketError,
      emitWithCardId,
      handleCardUpdate,
      handleSocketMount,
    };
  },
};