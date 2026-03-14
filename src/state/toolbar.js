// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";

const toolbarSlice = createSlice({
  name: 'toolbar',
  initialState: {
    filterIsOpen: true,
    filterIsEnabled: false,
    filterValue: "",
    globalSearchValue: "",
    settingsOpen: false,
    splitPanel: true,
    fieldInspector: true,
    fastRender: false,
    requestGeneratorOpen: false,
    templateManagerOpen: false,
    statsOpen: false,
    paused: false,
  },
  reducers: {
    toggleFilter(state) {
      state.filterIsOpen = !state.filterIsOpen;
    },
    setFilterValue(state, action) {
      const { payload } = action;
      state.filterValue = payload;
      state.filterIsEnabled = !!(state.filterValue && state.filterValue.length > 0);
    },
    setGlobalSearchValue(state, action) {
      const { payload } = action;
      state.globalSearchValue = payload;
    },
    setSettingsOpen(state, action) {
      state.settingsOpen = action.payload;
    },
    setSplitPanel(state, action) {
      state.splitPanel = action.payload;
    },
    setFieldInspector(state, action) {
      state.fieldInspector = action.payload;
    },
    setFastRender(state, action) {
      state.fastRender = action.payload;
    },
    setRequestGeneratorOpen(state, action) {
      state.requestGeneratorOpen = action.payload;
    },
    setTemplateManagerOpen(state, action) {
      state.templateManagerOpen = action.payload;
    },
    setStatsOpen(state, action) {
      state.statsOpen = action.payload;
    },
    setPaused(state, action) {
      state.paused = action.payload;
    },
  },

});

const { actions, reducer } = toolbarSlice;
export const { toggleFilter, setFilterValue, setGlobalSearchValue, setSettingsOpen, setSplitPanel, setFieldInspector, setFastRender, setRequestGeneratorOpen, setTemplateManagerOpen, setStatsOpen, setPaused } = actions;

export default reducer
