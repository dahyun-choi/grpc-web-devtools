// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";

const clipboardSlice = createSlice({
  name: 'clipboard',
  initialState: {
    clipboardIsEnabled: true,
  },
  reducers: {
    toggleClipboard() {
    }
  },

});

const { actions, reducer } = clipboardSlice;
export const { toggleClipboard } = actions;

export default reducer
