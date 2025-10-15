import streamlit as st

st.set_page_config(page_title="Auto 3D AMV", layout="wide")

st.write("## 🎬 Auto 3D AMV — Streamlit")
st.caption("Front-end is served from the /static folder so your local modules just work.")

# Streamlit Cloud usually serves /app/static/...; local runs serve /static/...
# We'll render an <iframe> that tries /app/static/index.html first, with a JavaScript
# fallback to /static/index.html if needed.
html = """
<iframe id="amvFrame" src="/app/static/index.html"
        style="width:100%;height:88vh;border:0;border-radius:12px;background:#0b0f19;"></iframe>
<script>
  (function(){
    var f = document.getElementById('amvFrame');
    // If /app/static doesn't exist locally, swap to /static
    fetch('/app/static/index.html', {method:'HEAD'}).then(function(res){
      if (!res.ok) throw 0;
    }).catch(function(){
      f.src = '/static/index.html';
    });
  })();
</script>
"""
st.components.v1.html(html, height=850, scrolling=True)
