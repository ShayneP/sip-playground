"use client";

import { LoadingSVG } from "@/components/button/LoadingSVG";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { ColorPicker } from "@/components/colorPicker/ColorPicker";
import { AudioInputTile } from "@/components/config/AudioInputTile";
import { ConfigurationPanelItem } from "@/components/config/ConfigurationPanelItem";
import { NameValueRow } from "@/components/config/NameValueRow";
import { PlaygroundHeader } from "@/components/playground/PlaygroundHeader";
import {
  PlaygroundTab,
  PlaygroundTabbedTile,
  PlaygroundTile,
} from "@/components/playground/PlaygroundTile";
import { AgentMultibandAudioVisualizer } from "@/components/visualization/AgentMultibandAudioVisualizer";
import { useConfig } from "@/hooks/useConfig";
import { useMultibandTrackVolume } from "@/hooks/useTrackVolume";
import { TranscriptionTile } from "@/transcriptions/TranscriptionTile";
import {
  TrackReferenceOrPlaceholder,
  VideoTrack,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomInfo,
  useTracks,
} from "@livekit/components-react";
import {
  ConnectionState,
  LocalParticipant,
  RoomEvent,
  Track,
} from "livekit-client";
import { set } from "lodash";
import { disconnect } from "process";
import { QRCodeSVG } from "qrcode.react";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";

export interface PlaygroundMeta {
  name: string;
  value: string;
}

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
}

const headerHeight = 56;

export default function Playground({
  logo,
  themeColors,
  onConnect,
}: PlaygroundProps) {
  const { config, setUserSettings } = useConfig();
  const { name } = useRoomInfo();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [transcripts, setTranscripts] = useState<ChatMessageType[]>([]);
  const { localParticipant } = useLocalParticipant();
  const [currentAgentTrack, setCurrentAgentTrack] = useState<TrackReferenceOrPlaceholder | null>(null);

  const participants = useRemoteParticipants({
    updateOnlyOn: [RoomEvent.ParticipantMetadataChanged],
  });
  const agentParticipant = participants.find((p) => p.isAgent);
  const sipParticipant = participants.find((p) => p.name === "SIP");
  const isAgentConnected = agentParticipant !== undefined;
  const isSipConnected = sipParticipant !== undefined;

  const roomState = useConnectionState();
  const tracks = useTracks();

  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      localParticipant.setCameraEnabled(config.settings.inputs.camera);
      localParticipant.setMicrophoneEnabled(config.settings.inputs.mic);
      
      // Find the last agent track
      const agentTracks = tracks.filter(
        (trackRef) =>
          trackRef.publication.kind === Track.Kind.Audio &&
          trackRef.participant.isAgent
      );
      const lastAgentTrack = agentTracks.length > 0 ? agentTracks[agentTracks.length - 1] : null;
      console.log("Last agent track", lastAgentTrack);
      console.log("Tracks", tracks);
      console.log("Agent tracks length", agentTracks.length);
      
      setCurrentAgentTrack(lastAgentTrack);
    }
  }, [roomState, tracks, localParticipant]); // Add dependencies to useEffect

  let agentAudioTrack: TrackReferenceOrPlaceholder | undefined;
  const aat = tracks.find(
    (trackRef) =>
      trackRef.publication.kind === Track.Kind.Audio &&
      trackRef.participant.isAgent
  );
  if (aat) {
    agentAudioTrack = aat;
  } else if (agentParticipant) {
    agentAudioTrack = {
      participant: agentParticipant,
      source: Track.Source.Microphone,
    };
  }

  let phoneAudioTrack: TrackReferenceOrPlaceholder | undefined;
  const pat = tracks.find(
    (trackRef) =>
      trackRef.publication.kind === Track.Kind.Audio &&
      trackRef.participant.name === "SIP"
  );
  if (pat) {
    phoneAudioTrack = pat;
  } else if (sipParticipant) {
    // Change over the agent visualizer
    phoneAudioTrack = {
      participant: sipParticipant,
      source: Track.Source.Microphone,
    };
  }

  let localAudioTrack: TrackReferenceOrPlaceholder | undefined;
  const lat = tracks.find(
    (trackRef) =>
      trackRef.publication.kind === Track.Kind.Audio &&
      trackRef.participant === localParticipant
  );

  const subscribedAgentVolumes = useMultibandTrackVolume(
    currentAgentTrack?.publication?.track,
    5
  );

  const subscribedPhoneVolumes = useMultibandTrackVolume(
    phoneAudioTrack?.publication?.track,
    10
  );

  const localTracks = tracks.filter(
    ({ participant }) => participant instanceof LocalParticipant
  );
  const localVideoTrack = localTracks.find(
    ({ source }) => source === Track.Source.Camera
  );
  const localMicTrack = localTracks.find(
    ({ source }) => source === Track.Source.Microphone
  );

  const localMultibandVolume = useMultibandTrackVolume(
    localMicTrack?.publication.track,
    10
  );

  const onDataReceived = useCallback(
    (msg: any) => {
      if (msg.topic === "transcription") {
        const decoded = JSON.parse(
          new TextDecoder("utf-8").decode(msg.payload)
        );
        let timestamp = new Date().getTime();
        if ("timestamp" in decoded && decoded.timestamp > 0) {
          timestamp = decoded.timestamp;
        }
        setTranscripts([
          ...transcripts,
          {
            name: "You",
            message: decoded.text,
            timestamp: timestamp,
            isSelf: true,
          },
        ]);
      }
    },
    [transcripts]
  );

  useDataChannel(onDataReceived);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isCalling, setIsCalling] = useState(false);

  const phoneTileContent = useMemo(() => {

    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        Connect to make a call.
      </div>
    );

    const noPhoneContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        <input
          type="text"
          placeholder="Enter phone number"
          id="phoneNumberInput"
          className="border p-2 rounded text-center"
        />
        <button
          onClick={() => {
            setIsCalling(true);
            const phoneNumber = (document.getElementById('phoneNumberInput') as HTMLInputElement).value;
            if (phoneNumber) {
              // Send fetch request
              fetch('http://localhost:4567/api/create_sip_participant', {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ phoneNumber, roomName: name }),
              }).then(response => {
                setIsCalling(true);
              }).catch(error => {
                // Hide loading spinner and handle error
                setIsCalling(true);
              });
            }
          }}
          className="flex flex-row  text-gray-950 text-sm justify-center border border-transparent bg-cyan-500 px-3 py-1 rounded-md transition ease-out duration-250 hover:bg-transparent hover:shadow-cyan hover:border-cyan-500 hover:text-cyan-500 active:scale-[0.98] undefined"
        >
          Call
        </button>
        <div id="loadingSpinner" style={{ display: 'none' }}>
          <LoadingSVG />
        </div>
      </div>
    );
  
    const waitingContent = (
      <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        Waiting for phone to connect
      </div>
    );
  
    // TODO: keep it in the speaking state until we come up with a better protocol for agent states
    const visualizerContent = (
      <div className="flex items-center justify-center w-full">
        <AgentMultibandAudioVisualizer
          state="speaking"
          barWidth={30}
          minBarHeight={30}
          maxBarHeight={150}
          accentColor={"cyan"}
          accentShade={500}
          frequencies={subscribedPhoneVolumes}
          borderRadius={12}
          gap={16}
        />
      </div>
    );
  
    if (roomState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }
  
    if (!phoneAudioTrack) {
      return noPhoneContent;
    }

    if (isCalling && !phoneAudioTrack) {
      return waitingContent;
    }
  
    return visualizerContent;
  }, [
    phoneAudioTrack,
    config.settings.theme_color,
    subscribedPhoneVolumes,
    roomState,
  ]);

  const audioTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        No audio track. Connect to get started.
      </div>
    );

    const waitingContent = (
      <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        Waiting for audio track
      </div>
    );

    // TODO: keep it in the speaking state until we come up with a better protocol for agent states
    const visualizerContent = (
      <div className="flex items-center justify-center w-full">
        <AgentMultibandAudioVisualizer
          state="speaking"
          barWidth={30}
          minBarHeight={30}
          maxBarHeight={150}
          accentColor={config.settings.theme_color}
          accentShade={500}
          frequencies={localMultibandVolume}
          borderRadius={12}
          gap={16}
        />
      </div>
    );
    
    if (roomState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }

    if (!localMicTrack) {
      return waitingContent;
    }

    return visualizerContent;
  }, [
    localMicTrack,
    config.settings.theme_color,
    localMultibandVolume,
    roomState,
  ]);

  const chatTileContent = useMemo(() => {
    if (agentAudioTrack) {
      return (
        <TranscriptionTile
          sipParticipant={sipParticipant}
          agentAudioTrack={agentAudioTrack}
          accentColor={config.settings.theme_color}
        />
      );
    }
    return <></>;
  }, [config.settings.theme_color, agentAudioTrack]);

  const settingsTileContent = useMemo(() => {
    return (
      <div className="flex flex-col gap-4 h-full w-full items-start overflow-y-auto">
        {config.description && (
          <ConfigurationPanelItem title="Description">
            {config.description}
          </ConfigurationPanelItem>
        )}

        <ConfigurationPanelItem title="Settings">
          {localParticipant && (
            <div className="flex flex-col gap-2">
              <NameValueRow
                name="Room"
                value={name}
                valueColor={`${config.settings.theme_color}-500`}
              />
              <NameValueRow
                name="Participant"
                value={localParticipant.identity}
              />
            </div>
          )}
        </ConfigurationPanelItem>
        <ConfigurationPanelItem title="Status">
          <div className="flex flex-col gap-2">
            <NameValueRow
              name="Room connected"
              value={
                roomState === ConnectionState.Connecting ? (
                  <LoadingSVG diameter={16} strokeWidth={2} />
                ) : (
                  roomState.toUpperCase()
                )
              }
              valueColor={
                roomState === ConnectionState.Connected
                  ? `${config.settings.theme_color}-500`
                  : "gray-500"
              }
            />
          </div>
        </ConfigurationPanelItem>
        {localVideoTrack && (
          <ConfigurationPanelItem
            title="Camera"
            deviceSelectorKind="videoinput"
          >
            <div className="relative">
              <VideoTrack
                className="rounded-sm border border-gray-800 opacity-70 w-full"
                trackRef={localVideoTrack}
              />
            </div>
          </ConfigurationPanelItem>
        )}
        {localMicTrack && (
          <ConfigurationPanelItem
            title="Microphone"
            deviceSelectorKind="audioinput"
          >
          </ConfigurationPanelItem>
        )}
        <div className="w-full">
          <ConfigurationPanelItem title="Color">
            <ColorPicker
              colors={themeColors}
              selectedColor={config.settings.theme_color}
              onSelect={(color) => {
                const userSettings = { ...config.settings };
                userSettings.theme_color = color;
                setUserSettings(userSettings);
              }}
            />
          </ConfigurationPanelItem>
        </div>
        {config.show_qr && (
          <div className="w-full">
            <ConfigurationPanelItem title="QR Code">
              <QRCodeSVG value={window.location.href} width="128" />
            </ConfigurationPanelItem>
          </div>
        )}
      </div>
    );
  }, [
    config.description,
    config.settings,
    config.show_qr,
    localParticipant,
    name,
    roomState,
    isAgentConnected,
    localVideoTrack,
    localMicTrack,
    localMultibandVolume,
    themeColors,
    setUserSettings,
  ]);

  let mobileTabs: PlaygroundTab[] = [];
  if (config.settings.outputs.audio) {
    mobileTabs.push({
      title: "Audio",
      content: (
        <PlaygroundTile
          className="w-full h-full grow"
          childrenClassName="justify-center"
        >
          {audioTileContent}
        </PlaygroundTile>
      ),
    });
  }

  if (config.settings.chat) {
    mobileTabs.push({
      title: "Chat",
      content: chatTileContent,
    });
  }

  mobileTabs.push({
    title: "Settings",
    content: (
      <PlaygroundTile
        padding={false}
        backgroundColor="gray-950"
        className="h-full w-full basis-1/4 items-start overflow-y-auto flex"
        childrenClassName="h-full grow items-start"
      >
        {settingsTileContent}
      </PlaygroundTile>
    ),
  });

  return (
    <>
      <PlaygroundHeader
        title={config.title}
        logo={logo}
        githubLink={config.github_link}
        height={headerHeight}
        accentColor={config.settings.theme_color}
        connectionState={roomState}
        onConnectClicked={() =>
          onConnect(roomState === ConnectionState.Disconnected)
        }
      />
      <div
        className={`flex gap-4 py-4 grow w-full selection:bg-${config.settings.theme_color}-900`}
        style={{ height: `calc(100% - ${headerHeight}px)` }}
      >
        <div className="flex flex-col grow basis-1/2 gap-4 h-full lg:hidden">
          <PlaygroundTabbedTile
            className="h-full"
            tabs={mobileTabs}
            initialTab={mobileTabs.length - 1}
          />
        </div>
        <div
          className={`flex-col grow basis-1/2 gap-4 h-full hidden lg:${
            !config.settings.outputs.audio ? "hidden" : "flex"
          }`}
        >
          {config.settings.outputs.audio && (
            <PlaygroundTile
              title="Phone Audio"
              className="w-full h-full grow"
              childrenClassName="justify-center"
            >
              {phoneTileContent}
            </PlaygroundTile>
          )}
          {config.settings.outputs.audio && (
            <PlaygroundTile
              title="Local Audio"
              className="w-full h-full grow"
              childrenClassName="justify-center"
            >
              {audioTileContent}
            </PlaygroundTile>
          )}
        </div>

        {config.settings.chat && (
          <PlaygroundTile
            title="Chat"
            className="h-full grow basis-1/4 hidden lg:flex"
          >
            {chatTileContent}
          </PlaygroundTile>
        )}
        <PlaygroundTile
          padding={false}
          backgroundColor="gray-950"
          className="h-full w-full basis-1/4 items-start overflow-y-auto hidden max-w-[480px] lg:flex"
          childrenClassName="h-full grow items-start"
        >
          {settingsTileContent}
        </PlaygroundTile>
      </div>
    </>
  );
}