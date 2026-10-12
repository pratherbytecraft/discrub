import { useDispatch, useSelector, useStore, TypedUseSelectorHook } from 'react-redux';
import type { Store } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from './store';

/**
 * Typed hooks for Redux
 * Use these throughout the app instead of plain `useDispatch` and `useSelector`
 */
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
/** The store itself, for reading state inside an effect without subscribing. */
export const useAppStore: () => Store<RootState> = useStore;
