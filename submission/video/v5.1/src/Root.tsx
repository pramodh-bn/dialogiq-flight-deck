import React from "react";
import { Composition } from "remotion";
import { PresentationV5, totalFramesV5 } from "./Presentation4";
export const Root: React.FC = () => <Composition id="PresentationV5" component={PresentationV5} durationInFrames={totalFramesV5} fps={30} width={1920} height={1080} />;
