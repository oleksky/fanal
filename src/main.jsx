import React from "react";
import ReactDOM from "react-dom/client";
import FanalApp from "./App.jsx";
import PhoneFrame from "./PhoneFrame.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PhoneFrame>
      <FanalApp />
    </PhoneFrame>
  </React.StrictMode>
);
