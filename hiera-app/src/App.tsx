import { useEffect, useRef, useState } from 'react';
import './redesign.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import FormattedMessage from './FormattedMessage';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;