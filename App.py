# App.py  — minimal, reliable
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Auto 3D AMV", layout="wide")
st.write("## 🎬 Auto 3D AMV — Streamlit")
st.caption("Front-end is being served from the /static folder.")

# Embed the static site
components.html(
    """
    <iframe id="amvFrame" src="/static/index.html"
            style="width:100%;height:88vh;border:0;border-radius:12px;background:#0b0f19;"></iframe>
    """,
    height=850,
    scrolling=True,
)
